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
    next();
});

// Home route - test if server works
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Sale Point</title>
            <style>
                body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f5f7fa; }
                .card { background: white; padding: 40px; border-radius: 16px; text-align: center; box-shadow: 0 4px 16px rgba(0,0,0,0.1); }
                h1 { color: #2E7D32; }
                .btn { display: inline-block; padding: 12px 24px; background: #2E7D32; color: white; text-decoration: none; border-radius: 8px; margin-top: 20px; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>Sale Point</h1>
                <p>Server is running correctly!</p>
                <a href="/login" class="btn">Go to Login</a>
            </div>
        </body>
        </html>
    `);
});

// Only load routes if supabase connects
try {
    const supabase = require('./utils/supabase');
    console.log('Supabase loaded');
    
    app.use('/', require('./routes/authRoutes'));
    app.use('/', require('./routes/dashboardRoutes'));
    app.use('/', require('./routes/inventoryRoutes'));
    app.use('/', require('./routes/salesRoutes'));
    app.use('/', require('./routes/reportsRoutes'));
    
} catch (error) {
    console.error('Failed to load routes:', error.message);
}

// Export for Vercel
module.exports = app;