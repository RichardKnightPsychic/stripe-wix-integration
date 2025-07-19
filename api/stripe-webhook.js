// api/stripe-webhook.js

// Configure this function to receive raw body
export const config = {
  api: {
    bodyParser: false,
  },
}

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    req.on('data', (chunk) => {
      buffer += chunk;
    });
    req.on('end', () => {
      resolve(buffer);
    });
    req.on('error', (error) => {
      reject(error);
    });
  });
}

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get raw body for signature verification
    const rawBody = await getRawBody(req);
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
    } catch (err) {
      console.log(`Webhook signature verification failed.`, err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the checkout.session.completed event
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      
      // Check if this purchase is for Revolutionary Tarot using your custom metadata
      const isRevolutionaryTarot = session.metadata && 
        (session.metadata.Label === 'RT2025' || 
         (session.metadata['Wix Label'] && session.metadata['Wix Label'].includes('Revolutionary Tarot')));
      
      if (!isRevolutionaryTarot) {
        console.log('Purchase is not for Revolutionary Tarot product, skipping');
        console.log('Found metadata:', session.metadata);
        return res.status(200).json({ received: true, skipped: 'Not Revolutionary Tarot product' });
      }
      
      console.log('✅ Revolutionary Tarot purchase detected!');
      console.log('Product metadata:', session.metadata);
      
      // Extract customer information
      const customerEmail = session.customer_email || session.customer_details?.email;
      const customerName = session.customer_details?.name;
      
      // Extract last name from custom fields
      let lastName = '';
      if (session.custom_fields && session.custom_fields.length > 0) {
        const lastNameField = session.custom_fields.find(field => 
          field.key === 'firstname' || field.label?.custom === 'Last name'
        );
        if (lastNameField && lastNameField.text) {
          lastName = lastNameField.text.value || '';
        }
      }
      
      if (!customerEmail) {
        console.log('No customer email found in session');
        return res.status(400).json({ error: 'No customer email' });
      }

      // Use the name from customer_details as first name, custom field as last name
      const firstName = customerName || '';
      
      console.log('Extracted names - First:', firstName, 'Last:', lastName);

      // Add to Wix
      await addToWixContacts({
        email: customerEmail,
        firstName: firstName,
        lastName: lastName,
        phone: session.customer_details?.phone || '',
        purchaseAmount: session.amount_total / 100, // Convert from cents
        purchaseDate: new Date().toISOString(),
        stripeSessionId: session.id
      });

      console.log('Successfully added customer to Wix:', customerEmail);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function addToWixContacts(customerData) {
  try {
    console.log('Triggering Wix automation with data:', customerData);
    
    // Send data to Wix automation webhook
    const wixWebhookUrl = 'https://manage.wix.com/_api/webhook-trigger/report/eba6c093-a3ac-490a-9225-2074dc2da305/9be99176-4678-4c0d-82a5-122fe194a710';
    
    // Prepare data for Wix automation
    const automationData = {
      email: customerData.email,
      firstName: customerData.firstName,
      lastName: customerData.lastName,
      phone: customerData.phone,
      purchaseAmount: customerData.purchaseAmount,
      purchaseDate: customerData.purchaseDate,
      stripeSessionId: customerData.stripeSessionId
    };

    console.log('Data to send to Wix automation:', JSON.stringify(automationData, null, 2));

    const response = await fetch(wixWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(automationData)
    });

    console.log('Wix automation response status:', response.status);
    
    if (!response.ok) {
      const errorData = await response.text();
      console.log('Wix automation error details:', errorData);
      throw new Error(`Wix automation error: ${response.status} - ${errorData}`);
    }

    const result = await response.text();
    console.log('Wix automation triggered successfully:', result);
    return { success: true };
    
  } catch (error) {
    console.error('Error triggering Wix automation:', error);
    throw error;
  }
}
