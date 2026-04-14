const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
require('dotenv').config();

const app = express();

// Trust proxy for Vercel
app.set('trust proxy', 1);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Session setup - RESTORED
app.use(session({
    secret: process.env.SESSION_SECRET || 'salepoint-secret-key-2024',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Make data available to views
app.use((req, res, next) => {
    res.locals.error = null;
    res.locals.success = null;
    res.locals.user = req.session.user || null;
    res.locals.shop = req.session.shop || null;
    next();
});

// Load routes
try {
    app.use('/', require('./routes/authRoutes'));
    console.log('✅ authRoutes loaded');
} catch (error) {
    console.error('❌ authRoutes failed:', error.message);
}

try {
    app.use('/', require('./routes/dashboardRoutes'));
    console.log('✅ dashboardRoutes loaded');
} catch (error) {
    console.error('❌ dashboardRoutes failed:', error.message);
}

try {
    app.use('/', require('./routes/inventoryRoutes'));
    console.log('✅ inventoryRoutes loaded');
} catch (error) {
    console.error('❌ inventoryRoutes failed:', error.message);
}

try {
    app.use('/', require('./routes/salesRoutes'));
    console.log('✅ salesRoutes loaded');
} catch (error) {
    console.error('❌ salesRoutes failed:', error.message);
}

try {
    app.use('/', require('./routes/reportsRoutes'));
    console.log('✅ reportsRoutes loaded');
} catch (error) {
    console.error('❌ reportsRoutes failed:', error.message);
}

try {
    app.use('/', require('./routes/settingsRoutes'));
    console.log('✅ settingsRoutes loaded');
} catch (error) {
    console.error('❌ settingsRoutes failed:', error.message);
}

// Home route
app.get('/', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('index');
});

// 404 handler
app.use((req, res) => {
    res.status(404).render('404', { url: req.url });
});

// Export for Vercel
module.exports = app;

// Local development
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Sale Point running at http://localhost:${PORT}`);
    });
}