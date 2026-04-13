const express = require('express');
const router = express.Router();
const supabase = require('../utils/supabase');

const requireAuth = (req, res, next) => {
    if (!req.session.user || !req.session.shop) {
        return res.redirect('/login');
    }
    next();
};

// GET - Sales Page
router.get('/sales', requireAuth, async (req, res) => {
    const shopId = req.session.shop.id;
    
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
    const cart = req.session.cart || [];
    const cartTotal = cart.reduce((sum, item) => sum + item.total_price, 0);
    const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
    
    res.render('sales', {
        shop: req.session.shop,
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
    const shopId = req.session.shop.id;
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
    
    // Check available stock (only for warning, don't block)
    const availableUnits = (product.current_stock_cartons * product.pieces_per_carton) + product.current_stock_loose_pieces;
    
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
        // Update existing
        const existing = req.session.cart[existingIndex];
        const newQty = existing.quantity + qty;
        
        existing.quantity = newQty;
        existing.total_price = newQty * unitPrice;
    } else {
        // Add new
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
    
    // If stock is insufficient, add warning but still allow
    const cartItem = req.session.cart.find(item => item.product_id === product_id);
    if (cartItem && cartItem.quantity > availableUnits) {
        return res.redirect(`/sales?warning=Only ${availableUnits} ${product.selling_unit}(s) in stock. You'll need to restock soon.`);
    }
    
    res.redirect('/sales');
});

// POST - Update Cart Item (Quantity and/or Price)
router.post('/sales/update', requireAuth, async (req, res) => {
    const { index, quantity, unit_price } = req.body;
    const qty = parseFloat(quantity) || 0;
    const newUnitPrice = parseFloat(unit_price) || 0;
    const idx = parseInt(index);
    
    if (!req.session.cart || !req.session.cart[idx]) {
        return res.redirect('/sales?error=Item not found');
    }
    
    if (qty <= 0) {
        // Remove item
        req.session.cart.splice(idx, 1);
        return res.redirect('/sales');
    }
    
    const item = req.session.cart[idx];
    const shopId = req.session.shop.id;
    
    // Check stock (only for warning)
    const { data: product } = await supabase
        .from('products')
        .select('*')
        .eq('id', item.product_id)
        .eq('shop_id', shopId)
        .single();
    
    // Update quantity
    item.quantity = qty;
    
    // Update price if provided
    if (newUnitPrice > 0) {
        item.unit_price = newUnitPrice;
    }
    
    // Recalculate total
    item.total_price = item.quantity * item.unit_price;
    
    if (product) {
        const availableUnits = (product.current_stock_cartons * product.pieces_per_carton) + product.current_stock_loose_pieces;
        
        if (qty > availableUnits) {
            return res.redirect(`/sales?warning=Only ${availableUnits} ${product.selling_unit}(s) in stock. Stock will go negative.`);
        }
    }
    
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
    const shopId = req.session.shop.id;
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
    
    // Calculate total cost of goods sold
    let totalCost = 0;
    let hasOversell = false;
    let oversellMessages = [];
    
    for (const item of cart) {
        const { data: product } = await supabase
            .from('products')
            .select('*')
            .eq('id', item.product_id)
            .eq('shop_id', shopId)
            .single();
        
        if (!product) {
            return res.redirect('/sales?error=Product not found');
        }
        
        // Calculate cost for this item
        // Get the average cost from stock batches or use a default
        const { data: batches } = await supabase
            .from('stock_batches')
            .select('cost_price_per_carton, remaining_cartons')
            .eq('product_id', item.product_id)
            .gt('remaining_cartons', 0)
            .order('created_at', { ascending: true });
        
        let itemCost = 0;
        
        if (batches && batches.length > 0) {
            // Use FIFO - First In First Out
            let unitsToCover = item.quantity;
            let batchIndex = 0;
            
            while (unitsToCover > 0 && batchIndex < batches.length) {
                const batch = batches[batchIndex];
                const unitsInBatch = batch.remaining_cartons * product.pieces_per_carton;
                const costPerUnit = batch.cost_price_per_carton / product.pieces_per_carton;
                
                if (unitsInBatch >= unitsToCover) {
                    itemCost += unitsToCover * costPerUnit;
                    unitsToCover = 0;
                } else {
                    itemCost += unitsInBatch * costPerUnit;
                    unitsToCover -= unitsInBatch;
                    batchIndex++;
                }
            }
            
            // If not enough batches, use 0 for remaining
        } else {
            // No batch data, cost is 0
            itemCost = 0;
        }
        
        totalCost += itemCost;
        
        const availableUnits = (product.current_stock_cartons * product.pieces_per_carton) + product.current_stock_loose_pieces;
        
        if (item.quantity > availableUnits) {
            hasOversell = true;
            oversellMessages.push(`${item.product_name}: sold ${item.quantity} but only ${availableUnits} in stock`);
        }
    }
    
    // Create sale record with calculated cost
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
    
    // Process each item (update stock and batches)
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
            
            // First use loose pieces
            if (newLoose > 0) {
                if (newLoose >= remainingQty) {
                    newLoose -= remainingQty;
                    remainingQty = 0;
                } else {
                    remainingQty -= newLoose;
                    newLoose = 0;
                }
            }
            
            // Then use full cartons
            if (remainingQty > 0) {
                const cartonsNeeded = Math.ceil(remainingQty / product.pieces_per_carton);
                newCartons -= cartonsNeeded;
                
                const totalPiecesFromCartons = cartonsNeeded * product.pieces_per_carton;
                const leftover = totalPiecesFromCartons - remainingQty;
                newLoose = leftover;
            }
            
            // Update product stock
            await supabase
                .from('products')
                .update({
                    current_stock_cartons: newCartons,
                    current_stock_loose_pieces: newLoose
                })
                .eq('id', item.product_id);
            
            // Update stock batches (reduce remaining_cartons)
            let unitsToDeduct = item.quantity;
            const { data: batches } = await supabase
                .from('stock_batches')
                .select('*')
                .eq('product_id', item.product_id)
                .gt('remaining_cartons', 0)
                .order('created_at', { ascending: true });
            
            if (batches) {
                for (const batch of batches) {
                    if (unitsToDeduct <= 0) break;
                    
                    const unitsInBatch = batch.remaining_cartons * product.pieces_per_carton;
                    const unitsToRemove = Math.min(unitsInBatch, unitsToDeduct);
                    const cartonsToRemove = unitsToRemove / product.pieces_per_carton;
                    
                    await supabase
                        .from('stock_batches')
                        .update({
                            remaining_cartons: batch.remaining_cartons - cartonsToRemove
                        })
                        .eq('id', batch.id);
                    
                    unitsToDeduct -= unitsToRemove;
                }
            }
        }
        
        // Record sale item
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
    
    // Calculate actual profit
    const actualProfit = total - totalCost;
    
    // Store receipt data
    req.session.lastSale = {
        id: sale.id,
        date: new Date().toISOString(),
        items: saleItems,
        total: total,
        cost: totalCost,
        profit: actualProfit,
        amount_paid: paid,
        change: change,
        payment_method: payment_method || 'cash',
        oversellWarning: hasOversell ? oversellMessages.join(', ') : null
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
        shop: req.session.shop,
        sale: lastSale
    });
});

module.exports = router;