const express = require('express');
const router = express.Router();
const supabase = require('../utils/supabase');
const bcrypt = require('bcryptjs');

// GET - Landing/Login Page
router.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('login', { error: null });
});

// GET - Registration Page
router.get('/register', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('register', { error: null });
});

// POST - Handle Registration
router.post('/register', async (req, res) => {
    const { shop_name, owner_name, email, password, confirm_password } = req.body;
    
    // Validation
    if (!shop_name || !email || !password) {
        return res.render('register', { error: 'All fields are required' });
    }
    
    if (password !== confirm_password) {
        return res.render('register', { error: 'Passwords do not match' });
    }
    
    if (password.length < 6) {
        return res.render('register', { error: 'Password must be at least 6 characters' });
    }
    
    try {
        // Check if shop already exists with this email
        const { data: existingShop } = await supabase
            .from('shops')
            .select('id')
            .eq('owner_email', email)
            .single();
        
        if (existingShop) {
            return res.render('register', { error: 'A shop with this email already exists' });
        }
        
        // Create Supabase Auth user
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email: email,
            password: password
        });
        
        if (authError) {
            return res.render('register', { error: authError.message });
        }
        
        // Insert shop record into shops table
        const { data: shopData, error: shopError } = await supabase
            .from('shops')
            .insert([
                {
                    shop_name: shop_name,
                    owner_email: email,
                    owner_name: owner_name || null
                }
            ])
            .select()
            .single();
        
        if (shopError) {
            return res.render('register', { error: 'Failed to create shop record' });
        }
        
        // Auto-login after registration
        req.session.user = {
            id: authData.user.id,
            email: email
        };
        req.session.shop = {
            id: shopData.id,
            name: shopData.shop_name
        };
        
        res.redirect('/dashboard');
        
    } catch (error) {
        console.error('Registration error:', error);
        res.render('register', { error: 'An unexpected error occurred' });
    }
});

// POST - Handle Login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.render('login', { error: 'Email and password are required' });
    }
    
    try {
        // Sign in with Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });
        
        if (authError) {
            return res.render('login', { error: 'Invalid email or password' });
        }
        
        // Get shop details
        const { data: shopData, error: shopError } = await supabase
            .from('shops')
            .select('id, shop_name')
            .eq('owner_email', email)
            .single();
        
        if (shopError) {
            return res.render('login', { error: 'Shop not found' });
        }
        
        // Set session
        req.session.user = {
            id: authData.user.id,
            email: email
        };
        req.session.shop = {
            id: shopData.id,
            name: shopData.shop_name
        };
        
        res.redirect('/dashboard');
        
    } catch (error) {
        console.error('Login error:', error);
        res.render('login', { error: 'An unexpected error occurred' });
    }
});

// GET - Logout
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

module.exports = router;