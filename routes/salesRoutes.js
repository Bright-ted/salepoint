const express = require('express');
const router = express.Router();
const supabase = require('../utils/supabase');

// Auth middleware - UPDATED for cookie-based auth
const requireAuth = async (req, res, next) => {
    const token = req.cookies?.sb_token;
    
    if (!token) {
        return res.redirect('/login');
    }
    
    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error || !user) {
            res.clearCookie('sb_token');
            return res.redirect('/login');
        }
        
        const { data: shop, error: shopError } = await supabase
            .from('shops')
            .select('id, shop_name, theme_color')
            .eq('owner_email', user.email)
            .single();
        
        if (shopError || !shop) {
            return res.redirect('/login');
        }
        
        req.user = user;
        req.shop = shop;
        res.locals.user = user;
        res.locals.shop = shop;
        
        next();
    } catch (error) {
        console.error('Auth error:', error);
        res.redirect('/login');
    }
};

// GET - Sales Page
router.get('/sales', requireAuth, async (req, res) => {
    const shopId = req.shop.id;
    
    // Get all products with stock
    const { data: products, error } = await supabase
        .from('products')
        .select('*')
        .eq('shop_id', shopId)
        .order('product_name', { ascending: true });
    
    // Calculate available units for each product
    const productsWithStock = (products || []).map(product => {
        const totalUnits = (product.current_stock_cartons * product.pieces_per_carton) + product.current_stock_loose_pieces;
        return {
            ...product,
            available_units: totalUnits,
            in_stock: totalUnits > 0,
            is_low_stock: totalUnits <= (product.low_stock_threshold * product.pieces_per_carton)
        };
    });
    
    // Calculate cart total
    const cart = req.session?.cart || [];
    const cartTotal = cart.reduce((sum, item) => sum + item.total_price, 0);
    const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
    
    res.render('sales', {
        shop: req.shop,
        products: productsWithStock,
        cart: cart,
        cartTotal: cartTotal,
        cartCount: cartCount,
        error: req.query.error || null,
        success: req.query.success || null
    });
});

// GET - New Sale (redirect to sales)
router.get('/sales/new', requireAuth, (req, res) => {
    res.redirect('/sales');
});

// POST - Add to Cart
router.post('/sales/add', requireAuth, async (req, res) => {
    const shopId = req.shop.id;
    const { product_id, quantity } = req.body;
    
    const qty = parseFloat(quantity) || 0;
    
    if (!product_id || qty <= 0) {
        return res.redirect('/sales?error=Please select a product and enter quantity');
    }
    
    // Get product
    const { data: product, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', product_id)
        .eq('shop_id', shopId)
        .single();
    
    if (error || !product) {
        return res.redirect('/sales?error=Product not found');
    }
    
    // Calculate price
    const unitPrice = parseFloat(product.selling_price_per_piece);
    const totalPrice = qty * unitPrice;
    
    // Initialize cart
    if (!req.session.cart) {
        req.session.cart = [];
    }
    
    // Check if product already in cart
    const existingIndex = req.session.cart.findIndex(item => item.product_id === product_id);
    
    if (existingIndex !== -1) {
        const existing = req.session.cart[existingIndex];
        existing.quantity += qty;
        existing.total_price = existing.quantity * unitPrice;
    } else {
        req.session.cart.push({
            product_id: product.id,
            product_name: product.product_name,
            selling_unit: product.selling_unit,
            pieces_per_carton: product.pieces_per_carton,
            unit_price: unitPrice,
            quantity: qty,
            total_price: totalPrice
        });
    }
    
    res.redirect('/sales');
});

// POST - Update Cart Item
router.post('/sales/update', requireAuth, async (req, res) => {
    const { index, quantity, unit_price } = req.body;
    const qty = parseFloat(quantity) || 0;
    const newUnitPrice = parseFloat(unit_price) || 0;
    const idx = parseInt(index);
    
    if (!req.session.cart || !req.session.cart[idx]) {
        return res.redirect('/sales?error=Item not found');
    }
    
    if (qty <= 0) {
        req.session.cart.splice(idx, 1);
        return res.redirect('/sales');
    }
    
    const item = req.session.cart[idx];
    
    item.quantity = qty;
    if (newUnitPrice > 0) {
        item.unit_price = newUnitPrice;
    }
    item.total_price = item.quantity * item.unit_price;
    
    res.redirect('/sales');
});

// POST - Remove from Cart
router.post('/sales/remove', requireAuth, (req, res) => {
    const { index } = req.body;
    const idx = parseInt(index);
    
    if (req.session.cart && req.session.cart[idx]) {
        req.session.cart.splice(idx, 1);
    }
    
    res.redirect('/sales');
});

// POST - Clear Cart
router.post('/sales/clear', requireAuth, (req, res) => {
    req.session.cart = [];
    res.redirect('/sales');
});

// POST - Complete Sale
router.post('/sales/complete', requireAuth, async (req, res) => {
    const shopId = req.shop.id;
    const { payment_method, amount_paid } = req.body;
    
    const cart = req.session.cart || [];
    
    if (cart.length === 0) {
        return res.redirect('/sales?error=Cart is empty');
    }
    
    const paid = parseFloat(amount_paid) || 0;
    const total = cart.reduce((sum, item) => sum + item.total_price, 0);
    
    if (paid < total) {
        return res.redirect(`/sales?error=Amount paid (₵${paid.toFixed(2)}) is less than total (₵${total.toFixed(2)})`);
    }
    
    const change = paid - total;
    let totalCost = 0;
    
    // Calculate costs
    for (const item of cart) {
        const { data: product } = await supabase
            .from('products')
            .select('*')
            .eq('id', item.product_id)
            .eq('shop_id', shopId)
            .single();
        
        if (product) {
            const { data: batches } = await supabase
                .from('stock_batches')
                .select('cost_price_per_carton')
                .eq('product_id', item.product_id)
                .limit(1)
                .single();
            
            if (batches) {
                const costPerUnit = batches.cost_price_per_carton / product.pieces_per_carton;
                totalCost += item.quantity * costPerUnit;
            }
        }
    }
    
    // Create sale record
    const { data: sale, error: saleError } = await supabase
        .from('sales')
        .insert([{
            shop_id: shopId,
            total_amount: total,
            total_cost: totalCost,
            payment_method: payment_method || 'cash',
            payment_received: paid,
            change_given: change
        }])
        .select()
        .single();
    
    if (saleError) {
        console.error('Sale error:', saleError);
        return res.redirect('/sales?error=Failed to complete sale');
    }
    
    // Process each item
    const saleItems = [];
    
    for (const item of cart) {
        const { data: product } = await supabase
            .from('products')
            .select('*')
            .eq('id', item.product_id)
            .single();
        
        if (product) {
            let remainingQty = item.quantity;
            let newCartons = product.current_stock_cartons;
            let newLoose = product.current_stock_loose_pieces;
            
            if (newLoose > 0) {
                if (newLoose >= remainingQty) {
                    newLoose -= remainingQty;
                    remainingQty = 0;
                } else {
                    remainingQty -= newLoose;
                    newLoose = 0;
                }
            }
            
            if (remainingQty > 0) {
                const cartonsNeeded = Math.ceil(remainingQty / product.pieces_per_carton);
                newCartons -= cartonsNeeded;
                const leftover = (cartonsNeeded * product.pieces_per_carton) - remainingQty;
                newLoose = leftover;
            }
            
            await supabase
                .from('products')
                .update({
                    current_stock_cartons: newCartons,
                    current_stock_loose_pieces: newLoose
                })
                .eq('id', item.product_id);
        }
        
        await supabase
            .from('sale_items')
            .insert([{
                sale_id: sale.id,
                product_id: item.product_id,
                cartons_sold: 0,
                pieces_sold: item.quantity,
                selling_price_per_piece: item.unit_price,
                cost_price_per_carton: 0
            }]);
        
        saleItems.push({
            name: item.product_name,
            quantity: item.quantity,
            unit: item.selling_unit,
            price: item.unit_price,
            total: item.total_price
        });
    }
    
    // Store receipt data in session
    req.session.lastSale = {
        id: sale.id,
        date: new Date().toISOString(),
        items: saleItems,
        total: total,
        amount_paid: paid,
        change: change,
        payment_method: payment_method || 'cash'
    };
    
    // Clear cart
    req.session.cart = [];
    
    res.redirect('/sales/receipt');
});

// GET - Receipt
router.get('/sales/receipt', requireAuth, (req, res) => {
    const lastSale = req.session.lastSale;
    
    if (!lastSale) {
        return res.redirect('/sales');
    }
    
    res.render('receipt', {
        shop: req.shop,
        sale: lastSale
    });
});

module.exports = router;