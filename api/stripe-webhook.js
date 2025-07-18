// stripe-webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const axios = require('axios');  // Correct import for axios

// Handler function
module.exports.handler = async function(event) {
  try {
    console.info('Webhook received:', event);

    // Parse Stripe session info (adjust based on your actual event structure)
    const session = JSON.parse(event.body);

    const email = session.customer_details?.email || '';
    const firstName = session.customer_details?.name?.split(' ')[0] || '';
    const lastName = session.customer_details?.name?.split(' ').slice(1).join(' ') || '';
    const purchaseDate = new Date().toISOString();
    const stripeSessionId = session.id || '';

    if (!email) {
      console.error('Email is missing in Stripe session.');
      return { statusCode: 400, body: 'Email missing' };
    }

    // Build contact data for Wix API
    const contactData = {
      contact: {
        info: {
          emails: [{ email, primary: true }],
          name: { first: firstName, last: lastName },
        },
        labels: ['Stripe MTHD RT 2025'],
      },
    };

    // Call Wix API to create contact
    const wixResponse = await axios.post(
      'https://www.wixapis.com/contacts/v4/contacts',
      contactData,
      {
        headers: {
          Authorization: `Bearer ${process.env.WIX_API_KEY}`,
          'Content-Type': 'application/json',
          'wix-site-id': process.env.WIX_SITE_ID,
        },
      }
    );

    console.info('Wix API response status:', wixResponse.status);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Contact created successfully' }),
    };
  } catch (error) {
    console.error('Error in webhook handler:', error.message || error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Internal Server Error' }),
    };
  }
};
