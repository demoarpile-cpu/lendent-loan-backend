const pool = require('../config/db');

exports.submitMessage = async (req, res) => {
    try {
        const { first_name, last_name, email, message } = req.body;
        
        if (!first_name || !last_name || !email || !message) {
            return res.status(400).json({ success: false, message: 'All fields are required.' });
        }

        const query = 'INSERT INTO contact_messages (first_name, last_name, email, message) VALUES (?, ?, ?, ?)';
        await pool.query(query, [first_name, last_name, email, message]);

        res.status(201).json({ success: true, message: 'Message sent successfully.' });
    } catch (error) {
        console.error('Submit contact message error:', error);
        res.status(500).json({ success: false, message: 'Failed to send message.' });
    }
};

exports.getMessages = async (req, res) => {
    try {
        const query = 'SELECT * FROM contact_messages ORDER BY created_at DESC';
        const [rows] = await pool.query(query);
        res.status(200).json({ success: true, messages: rows });
    } catch (error) {
        console.error('Get contact messages error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch messages.' });
    }
};

exports.markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const query = "UPDATE contact_messages SET status = 'read' WHERE id = ?";
        await pool.query(query, [id]);
        res.status(200).json({ success: true, message: 'Message marked as read.' });
    } catch (error) {
        console.error('Mark message as read error:', error);
        res.status(500).json({ success: false, message: 'Failed to update message.' });
    }
};
