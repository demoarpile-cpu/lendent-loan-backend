const axios = require('axios');
const FormData = require('form-data');

async function testRegistration() {
    try {
        const formData = new FormData();
        formData.append('name', 'Test Lender');
        formData.append('phone', '0981112233');
        formData.append('email', 'testlender@example.com');
        formData.append('password', 'password123');
        formData.append('nrc', '111111/11/1');
        formData.append('businessName', 'Test LLC');
        formData.append('lenderType', 'micro_lender');
        formData.append('role', 'lender');

        const res = await axios.post('http://localhost:5000/api/auth/register', formData, {
            headers: formData.getHeaders()
        });

        console.log('Registration Success:', res.data);
    } catch (e) {
        console.error('Registration Error:', e.response?.data || e.message);
    }
}

testRegistration();
