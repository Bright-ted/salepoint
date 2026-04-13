const express = require('express');
const router = express.Router();
const supabase = require('../utils/supabase');

const requireAuth = (req, res, next) => {
    if (!req.session.user || !req.session.shop) {
        return res.redirect('/login');
    }
    next();
};

// GET - Reports Page
router.get('/reports', requireAuth, async (req, res) => {
    const shopId = req.session.shop.id;
    const period = req.query.period || 'today';
    
    // Calculate date range based on period
    const now = new Date();
    let startDate = new Date();
    let endDate = new Date();
    
    switch(period) {
        case 'today':
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
            break;
        case 'yesterday':
            startDate.setDate(startDate.getDate() - 1);
            startDate.setHours(0, 0, 0, 0);
            endDate.setDate(endDate.getDate() - 1);
            endDate.setHours(23, 59, 59, 999);
            break;
        case 'this_week':
            startDate.setDate(startDate.getDate() - startDate.getDay());
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
            break;
        case 'this_month':
            startDate.setDate(1);
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
            break;
        case 'last_month':
            startDate.setMonth(startDate.getMonth() - 1);
            startDate.setDate(1);
            startDate.setHours(0, 0, 0, 0);
            endDate.setMonth(endDate.getMonth() - 1);
            endDate.setDate(new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate());
            endDate.setHours(23, 59, 59, 999);
            break;
        default:
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
    }
    
    try {
        // Get sales for period
        const { data: sales, error: salesError } = await supabase
            .from('sales')
            .select('*')
            .eq('shop_id', shopId)
            .gte('created_at', startDate.toISOString())
            .lte('created_at', endDate.toISOString())
            .order('created_at', { ascending: false });
        
        let totalSales = 0;
        let totalProfit = 0;
        let transactionCount = 0;
        let formattedSales = [];
        
        if (sales && sales.length > 0) {
            transactionCount = sales.length;
            
            for (const sale of sales) {
                totalSales += parseFloat(sale.total_amount || 0);
                totalProfit += parseFloat(sale.total_amount || 0) - parseFloat(sale.total_cost || 0);
                
                // Get item count
                const { count: itemCount } = await supabase
                    .from('sale_items')
                    .select('*', { count: 'exact', head: true })
                    .eq('sale_id', sale.id);
                
                formattedSales.push({
                    ...sale,
                    item_count: itemCount || 0
                });
            }
        }
        
        // Get top selling products
        const { data: saleItems, error: itemsError } = await supabase
            .from('sale_items')
            .select(`
                product_id,
                pieces_sold,
                selling_price_per_piece
            `)
            .in('sale_id', sales ? sales.map(s => s.id) : []);
        
        let productSales = {};
        
        if (saleItems) {
            for (const item of saleItems) {
                if (!productSales[item.product_id]) {
                    productSales[item.product_id] = {
                        quantity: 0,
                        revenue: 0
                    };
                }
                productSales[item.product_id].quantity += parseFloat(item.pieces_sold || 0);
                productSales[item.product_id].revenue += parseFloat(item.pieces_sold || 0) * parseFloat(item.selling_price_per_piece || 0);
            }
        }
        
        // Get product details
        const topProducts = [];
        
        for (const [productId, data] of Object.entries(productSales)) {
            const { data: product } = await supabase
                .from('products')
                .select('product_name, selling_unit')
                .eq('id', productId)
                .single();
            
            if (product) {
                topProducts.push({
                    product_name: product.product_name,
                    selling_unit: product.selling_unit,
                    total_quantity: data.quantity,
                    total_revenue: data.revenue
                });
            }
        }
        
        // Sort by revenue
        topProducts.sort((a, b) => b.total_revenue - a.total_revenue);
        
        const summary = {
            totalSales: totalSales,
            totalProfit: totalProfit,
            transactionCount: transactionCount,
            averageSale: transactionCount > 0 ? totalSales / transactionCount : 0
        };
        
        res.render('reports', {
            shop: req.session.shop,
            period: period,
            summary: summary,
            sales: formattedSales.slice(0, 20),
            topProducts: topProducts.slice(0, 10)
        });
        
    } catch (error) {
        console.error('Reports error:', error);
        res.render('reports', {
            shop: req.session.shop,
            period: period,
            summary: { totalSales: 0, totalProfit: 0, transactionCount: 0, averageSale: 0 },
            sales: [],
            topProducts: [],
            error: 'Failed to load reports'
        });
    }
});

module.exports = router;