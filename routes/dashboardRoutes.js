const express = require('express');
const router = express.Router();
const supabase = require('../utils/supabase');

// Middleware to check if user is logged in
const requireAuth = (req, res, next) => {
    if (!req.session.user || !req.session.shop) {
        return res.redirect('/login');
    }
    next();
};

// GET - Dashboard
router.get('/dashboard', requireAuth, async (req, res) => {
    const shopId = req.session.shop.id;
    
    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    try {
        // 1. Get today's sales summary
        const { data: todaySales, error: salesError } = await supabase
            .from('sales')
            .select('total_amount, total_cost')
            .eq('shop_id', shopId)
            .gte('created_at', today.toISOString())
            .lt('created_at', tomorrow.toISOString());
        
        let totalSales = 0;
        let totalProfit = 0;
        let transactionCount = 0;
        
        if (todaySales && todaySales.length > 0) {
            transactionCount = todaySales.length;
            todaySales.forEach(sale => {
                totalSales += parseFloat(sale.total_amount || 0);
                totalProfit += parseFloat(sale.total_amount || 0) - parseFloat(sale.total_cost || 0);
            });
        }
        
        // 2. Get low stock products (calculate available units)
        const { data: allProducts, error: productsError } = await supabase
            .from('products')
            .select('*')
            .eq('shop_id', shopId);
        
        let productCount = 0;
        let lowStockProducts = [];
        
        if (allProducts && allProducts.length > 0) {
            productCount = allProducts.length;
            
            // Find products with low stock
            lowStockProducts = allProducts.filter(product => {
                const totalUnits = (product.current_stock_cartons * product.pieces_per_carton) + product.current_stock_loose_pieces;
                const threshold = product.low_stock_threshold * product.pieces_per_carton;
                return totalUnits <= threshold;
            }).slice(0, 5).map(product => ({
                id: product.id,
                product_name: product.product_name,
                current_stock_cartons: product.current_stock_cartons,
                current_stock_loose_pieces: product.current_stock_loose_pieces,
                selling_unit: product.selling_unit,
                available_units: (product.current_stock_cartons * product.pieces_per_carton) + product.current_stock_loose_pieces
            }));
        }
        
        // 3. Get recent transactions with item details
        const { data: recentSales, error: recentError } = await supabase
            .from('sales')
            .select('*')
            .eq('shop_id', shopId)
            .order('created_at', { ascending: false })
            .limit(5);
        
        let formattedSales = [];
        
        if (recentSales && recentSales.length > 0) {
            // For each sale, get its items
            for (const sale of recentSales) {
                const { data: saleItems } = await supabase
                    .from('sale_items')
                    .select(`
                        quantity:pieces_sold,
                        product_id
                    `)
                    .eq('sale_id', sale.id);
                
                let itemCount = saleItems ? saleItems.length : 0;
                let firstProductName = 'Sale';
                
                if (saleItems && saleItems.length > 0) {
                    const firstItem = saleItems[0];
                    const { data: product } = await supabase
                        .from('products')
                        .select('product_name')
                        .eq('id', firstItem.product_id)
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
            shop: req.session.shop,
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
            shop: req.session.shop,
            stats: {
                todaySales: '0.00',
                todayProfit: '0.00',
                transactionCount: 0,
                productCount: 0,
                lowStockCount: 0
            },
            lowStockProducts: [],
            recentSales: [],
            error: 'Failed to load dashboard data'
        });
    }
});

module.exports = router;