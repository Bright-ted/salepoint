const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Make data available to views
app.use((req, res, next) => {
    res.locals.error = null;
    res.locals.success = null;
    res.locals.user = null;
    res.locals.shop = null;
    next();
});

// Load Supabase
let supabase;
try {
    supabase = require('./utils/supabase');
    console.log('✅ Supabase loaded');
} catch (error) {
    console.error('❌ Supabase failed:', error.message);
}

// Test route
app.get('/test', (req, res) => {
    res.send('Server is working!');
});

// Load routes with error catching
const routes = [
    { name: 'authRoutes', path: './routes/authRoutes' },
    { name: 'dashboardRoutes', path: './routes/dashboardRoutes' },
    { name: 'inventoryRoutes', path: './routes/inventoryRoutes' },
    { name: 'salesRoutes', path: './routes/salesRoutes' },
    { name: 'reportsRoutes', path: './routes/reportsRoutes' },
    { name: 'settingsRoutes', path: './routes/settingsRoutes' }
];

routes.forEach(route => {
    try {
        const router = require(route.path);
        app.use('/', router);
        console.log(`✅ ${route.name} loaded`);
    } catch (error) {
        console.error(`❌ ${route.name} failed:`, error.message);
    }
});

// Home route
app.get('/', (req, res) => {
    const token = req.cookies?.sb_token;
    if (token) {
        return res.redirect('/dashboard');
    }
    res.render('index');
});

// Catch-all error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err.message);
    res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Error</title>
            <style>
                body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f5f7fa; }
                .card { background: white; padding: 40px; border-radius: 16px; text-align: center; box-shadow: 0 4px 16px rgba(0,0,0,0.1); max-width: 500px; }
                h1 { color: #F44336; }
                p { color: #666; margin: 20px 0; }
                .btn { display: inline-block; padding: 12px 24px; background: #2E7D32; color: white; text-decoration: none; border-radius: 8px; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>Something went wrong</h1>
                <p>${err.message}</p>
                <a href="/" class="btn">Go Home</a>
            </div>
        </body>
        </html>
    `);
});

// Export for Vercel
module.exports = app;