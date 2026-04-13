const express = require('express');
const router = express.Router();
const supabase = require('../utils/supabase');

const requireAuth = (req, res, next) => {
    if (!req.session.user || !req.session.shop) {
        return res.redirect('/login');
    }
    next();
};

// GET - Inventory Page
router.get('/inventory', requireAuth, async (req, res) => {
    const shopId = req.session.shop.id;
    
    const { data: products, error } = await supabase
        .from('products')
        .select('*')
        .eq('shop_id', shopId)
        .order('product_name', { ascending: true });
    
    if (error) {
        console.error('Error fetching products:', error);
        return res.render('inventory', { 
            products: [], 
            error: 'Failed to load products',
            success: null,
            shop: req.session.shop
        });
    }
    
    res.render('inventory', { 
        products: products || [], 
        error: null,
        success: req.query.success || null,
        shop: req.session.shop
    });
});

// GET - Add Product Form
router.get('/inventory/add', requireAuth, (req, res) => {
    res.render('add-product', { 
        error: null,
        shop: req.session.shop,
        formData: {}
    });
});

// POST - Save New Product
router.post('/inventory/add', requireAuth, async (req, res) => {
    const shopId = req.session.shop.id;
    const { 
        product_name, 
        category, 
        carton_cost,
        selling_unit,
        pieces_per_carton,
        kg_per_carton,
        selling_price
    } = req.body;
    
    // Validation
    if (!product_name || !carton_cost || !selling_unit || !selling_price) {
        return res.render('add-product', { 
            error: 'All fields are required',
            shop: req.session.shop,
            formData: req.body
        });
    }
    
    // Determine quantity per carton based on selling unit
    let quantityPerCarton = 1;
    if (selling_unit === 'piece') {
        quantityPerCarton = parseInt(pieces_per_carton) || 1;
    } else if (selling_unit === 'kg') {
        quantityPerCarton = parseFloat(kg_per_carton) || 1;
    }
    
    const cartonCostValue = parseFloat(carton_cost);
    const sellingPriceValue = parseFloat(selling_price);
    
    const { error } = await supabase
        .from('products')
        .insert([{
            shop_id: shopId,
            product_name: product_name,
            category: category || 'Uncategorized',
            selling_unit: selling_unit,
            pieces_per_carton: quantityPerCarton,
            selling_price_per_piece: sellingPriceValue,
            current_stock_cartons: 0,
            current_stock_loose_pieces: 0
        }]);
    
    if (error) {
        console.error('Error adding product:', error);
        return res.render('add-product', { 
            error: 'Failed to add product',
            shop: req.session.shop,
            formData: req.body
        });
    }
    
    res.redirect('/inventory?success=Product added successfully');
});

// GET - Restock Form
router.get('/inventory/:id/restock', requireAuth, async (req, res) => {
    const shopId = req.session.shop.id;
    const productId = req.params.id;
    
    const { data: product, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', productId)
        .eq('shop_id', shopId)
        .single();
    
    if (error || !product) {
        return res.redirect('/inventory');
    }
    
    res.render('restock', { 
        product, 
        error: null,
        shop: req.session.shop
    });
});

// POST - Save Restock
router.post('/inventory/:id/restock', requireAuth, async (req, res) => {
    const shopId = req.session.shop.id;
    const productId = req.params.id;
    const { cartons_received, cost_price_per_carton, supplier } = req.body;
    
    const cartons = parseInt(cartons_received);
    const cost = parseFloat(cost_price_per_carton);
    
    // Validation
    if (!cartons || cartons < 1 || !cost || cost <= 0) {
        const { data: product } = await supabase
            .from('products')
            .select('*')
            .eq('id', productId)
            .eq('shop_id', shopId)
            .single();
        return res.render('restock', { 
            product, 
            error: 'Please enter valid numbers',
            shop: req.session.shop
        });
    }
    
    // Get current product
    const { data: product, error: fetchError } = await supabase
        .from('products')
        .select('*')
        .eq('id', productId)
        .eq('shop_id', shopId)
        .single();
    
    if (fetchError || !product) {
        return res.redirect('/inventory?error=Product not found');
    }
    
    // Update stock
    const newCartons = product.current_stock_cartons + cartons;
    const { error: updateError } = await supabase
        .from('products')
        .update({ current_stock_cartons: newCartons })
        .eq('id', productId);
    
    if (updateError) {
        console.error('Error updating stock:', updateError);
        return res.redirect('/inventory?error=Failed to update stock');
    }
    
    // Create batch record for profit tracking
    const { error: batchError } = await supabase
        .from('stock_batches')
        .insert([{
            product_id: productId,
            shop_id: shopId,
            cartons_added: cartons,
            cost_price_per_carton: cost,
            remaining_cartons: cartons,
            supplier: supplier || null
        }]);
    
    if (batchError) {
        console.error('Error creating batch:', batchError);
    }
    
    res.redirect('/inventory?success=Stock added successfully');
});

// GET - Delete Product
router.get('/inventory/:id/delete', requireAuth, async (req, res) => {
    const shopId = req.session.shop.id;
    const productId = req.params.id;
    
    const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', productId)
        .eq('shop_id', shopId);
    
    if (error) {
        return res.redirect('/inventory?error=Cannot delete product');
    }
    
    res.redirect('/inventory?success=Product deleted');
});

module.exports = router;