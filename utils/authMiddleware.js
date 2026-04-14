const supabase = require('./supabase');

const requireAuth = async (req, res, next) => {
    // Get token from cookie or authorization header
    const token = req.cookies?.sb_token || req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.redirect('/login');
    }
    
    try {
        // Verify the token with Supabase
        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error || !user) {
            // Clear invalid cookie
            res.clearCookie('sb_token');
            return res.redirect('/login');
        }
        
        // Get shop details
        const { data: shop, error: shopError } = await supabase
            .from('shops')
            .select('id, shop_name')
            .eq('owner_email', user.email)
            .single();
        
        if (shopError || !shop) {
            return res.redirect('/login');
        }
        
        // Attach user and shop to request
        req.user = user;
        req.shop = shop;
        
        // Also set in res.locals for views
        res.locals.user = user;
        res.locals.shop = shop;
        
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        res.redirect('/login');
    }
};

const requireGuest = (req, res, next) => {
    const token = req.cookies?.sb_token;
    
    if (token) {
        return res.redirect('/dashboard');
    }
    next();
};

module.exports = { requireAuth, requireGuest };