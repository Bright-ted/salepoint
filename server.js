const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
require('dotenv').config();

const app = express();
const supabase = require('./utils/supabase');

// Trust proxy for Vercel
app.set('trust proxy', 1);

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

// Routes
app.use('/', require('./routes/authRoutes'));
app.use('/', require('./routes/dashboardRoutes'));
app.use('/', require('./routes/inventoryRoutes'));
app.use('/', require('./routes/salesRoutes'));
app.use('/', require('./routes/reportsRoutes'));
app.use('/', require('./routes/settingsRoutes'));

// Home route
app.get('/', (req, res) => {
    const token = req.cookies?.sb_token;
    if (token) {
        return res.redirect('/dashboard');
    }
    res.render('index');
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