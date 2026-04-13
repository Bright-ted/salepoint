const express = require('express');
const session = require('express-session');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session setup
app.use(session({
    secret: process.env.SESSION_SECRET || 'salepoint-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // Auto-enable for Render
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Make session available to views
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.shop = req.session.shop || null;
    res.locals.error = null;
    res.locals.success = null;
    next();
});

// Routes
app.use('/', require('./routes/authRoutes'));
app.use('/', require('./routes/dashboardRoutes'));
app.use('/', require('./routes/inventoryRoutes'));
app.use('/', require('./routes/salesRoutes'));
app.use('/', require('./routes/reportsRoutes'));

// Home route
app.get('/', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('index');
});

// Export app for Vercel serverless environment
module.exports = app;

// Start server locally (not used on Vercel)
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Sale Point running at http://localhost:${PORT}`);
    });
}