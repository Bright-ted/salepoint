const express = require('express');
const router = express.Router();
const supabase = require('../utils/supabase');

// Middleware to check if user is logged in
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
        
        // Get shop details
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

// GET - Dashboard
router.get('/dashboard', requireAuth, async (req, res) => {
    const shopId = req.shop.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    try {
        // Get today's sales
        const { data: todaySales } = await supabase
            .from('sales')
            .select('total_amount, total_cost')
            .eq('shop_id', shopId)
            .gte('created_at', today.toISOString())
            .lt('created_at', tomorrow.toISOString());
        
        let totalSales = 0;
        let totalProfit = 0;
        let transactionCount = 0;
        
        if (todaySales) {
            transactionCount = todaySales.length;
            todaySales.forEach(sale => {
                totalSales += parseFloat(sale.total_amount || 0);
                totalProfit += parseFloat(sale.total_amount || 0) - parseFloat(sale.total_cost || 0);
            });
        }
        
        // Get products
        const { data: products } = await supabase
            .from('products')
            .select('*')
            .eq('shop_id', shopId);
        
        const productCount = products ? products.length : 0;
        
        const lowStockProducts = products ? products.filter(p => {
            const totalUnits = (p.current_stock_cartons * p.pieces_per_carton) + p.current_stock_loose_pieces;
            return totalUnits <= (p.low_stock_threshold * p.pieces_per_carton);
        }).slice(0, 5).map(p => ({
            id: p.id,
            product_name: p.product_name,
            available_units: (p.current_stock_cartons * p.pieces_per_carton) + p.current_stock_loose_pieces,
            selling_unit: p.selling_unit
        })) : [];
        
        // Get recent sales
        const { data: recentSales } = await supabase
            .from('sales')
            .select('*')
            .eq('shop_id', shopId)
            .order('created_at', { ascending: false })
            .limit(5);
        
        const formattedSales = [];
        
        if (recentSales) {
            for (const sale of recentSales) {
                const { data: items } = await supabase
                    .from('sale_items')
                    .select('pieces_sold, product_id')
                    .eq('sale_id', sale.id);
                
                let itemCount = items ? items.length : 0;
                let firstProductName = 'Sale';
                
                if (items && items.length > 0) {
                    const { data: product } = await supabase
                        .from('products')
                        .select('product_name')
                        .eq('id', items[0].product_id)
                        .single();
                    
                    if (product) {
                        firstProductName = product.product_name;
                    }
                }
                
                formattedSales.push({
                    id: sale.id,
                    total_amount: sale.total_amount,
                    payment_method: sale.payment_method,
                    created_at: sale.created_at,
                    item_count: itemCount,
                    first_product: firstProductName
                });
            }
        }
        
        res.render('dashboard', {
            shop: req.shop,
            stats: {
                todaySales: totalSales.toFixed(2),
                todayProfit: totalProfit.toFixed(2),
                transactionCount: transactionCount,
                productCount: productCount,
                lowStockCount: lowStockProducts.length
            },
            lowStockProducts: lowStockProducts,
            recentSales: formattedSales
        });
        
    } catch (error) {
        console.error('Dashboard error:', error);
        res.render('dashboard', {
            shop: req.shop,
            stats: { todaySales: '0.00', todayProfit: '0.00', transactionCount: 0, productCount: 0 },
            lowStockProducts: [],
            recentSales: []
        });
    }
});

module.exports = router;