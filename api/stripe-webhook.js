export const config = {
  api: {
    bodyParser: false,
  },
};

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
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

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      console.log('Webhook received for session:', session.id);
      console.log('Customer email:', session.customer_email || session.customer_details?.email);

      const customerEmail = session.customer_email || session.customer_details?.email;
      const customerName = session.customer_details?.name;

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

      const firstName = customerName || '';

      console.log('Extracted names - First:', firstName, 'Last:', lastName);

      await addToWixContacts({
        email: customerEmail,
        firstName: firstName,
        lastName: lastName,
        phone: session.customer_details?.phone || '',
        purchaseAmount: session.amount_total / 100,
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
    console.log('Attempting to create contact in Wix with data:', customerData);

    const contactData = {
      contact: {
        info: {
          emails: [
            {
              email: customerData.email,
              primary: true
            }
          ],
        },
        labels: ["Stripe MTHD RT 2025"]
      }
    };

    if (customerData.firstName) {
      contactData.contact.info.name = {
        first: customerData.firstName
      };

      if (customerData.lastName) {
        contactData.contact.info.name.last = customerData.lastName;
      }
    }

    if (customerData.phone && customerData.phone.trim() !== '') {
      contactData.contact.info.phones = [
        {
          phone: customerData.phone,
          primary: true
        }
      ];
    }

    console.log('Contact data to send:', JSON.stringify(contactData, null, 2));

    const createResponse = await fetch('https://www.wixapis.com/contacts/v4/contacts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WIX_API_KEY}`,
        'Content-Type': 'application/json',
        'wix-site-id': process.env.WIX_SITE_ID
      },
      body: JSON.stringify(contactData)
    });

    console.log('Create response status:', createResponse.status);

    if (!createResponse.ok) {
      const errorData = await createResponse.text();
      console.log('Wix create error details:', errorData);
      throw new Error(`Wix create error: ${createResponse.status} - ${errorData}`);
    }

    const result = await createResponse.json();
    console.log('Created contact in Wix:', result);
    return result;

  } catch (error) {
    console.error('Error managing contact in Wix:', error);
    throw error;
  }
}
