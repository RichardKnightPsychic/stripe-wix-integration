const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const buffer = require('micro').buffer;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send({ message: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  let rawBody;

  try {
    rawBody = await buffer(req);
  } catch (err) {
    return res.status(500).send({ error: 'Failed to read request body' });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('⚠️ Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log('✅ Checkout session completed:', session);
      break;

    // Add more event types as needed

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.status(200).send({ received: true });
};

module.exports.config = {
  api: {
    bodyParser: false // Stripe requires raw body for signature verification
  }
};
