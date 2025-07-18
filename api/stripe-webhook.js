const Stripe = require('stripe');
const axios = require('axios');

// Initialize Stripe with your secret key
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const sig = req.headers['stripe-signature'];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody || req.body, // rawBody for Vercel compatibility
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle specific event types
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    try {
      // Example: Send data to your Wix backend
      await axios.post('https://your-wix-endpoint.com/api/sync-payment', {
        sessionId: session.id,
        email: session.customer_email,
        amount_total: session.amount_total,
      });
    } catch (err) {
      console.error('Failed to send data to Wix backend:', err.message);
      return res.status(500).send('Failed to notify backend');
    }
  }

  res.status(200).send('Received');
};
