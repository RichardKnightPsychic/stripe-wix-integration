// api/stripe-webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify webhook signature
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.log(`Webhook signature verification failed.`, err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the checkout.session.completed event
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      
      // Check if this purchase is for the Revolutionary Tarot product
      const targetProductId = 'prod_Shc5isiU1QCROZ';
      
      // Get line items to check the product
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
        expand: ['data.price.product']
      });
      
      // Check if any line item matches our target product
      const hasTargetProduct = lineItems.data.some(item => 
        item.price.product.id === targetProductId
      );
      
      if (!hasTargetProduct) {
        console.log('Purchase does not include Revolutionary Tarot product, skipping');
        return res.status(200).json({ received: true, skipped: 'Not target product' });
      }
      
      // Extract customer information
      const customerEmail = session.customer_email || session.customer_details?.email;
      const customerName = session.customer_details?.name;
      
      if (!customerEmail) {
        console.log('No customer email found in session');
        return res.status(400).json({ error: 'No customer email' });
      }

      // Split name if available
      const nameParts = customerName ? customerName.split(' ') : ['', ''];
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

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

      console.log('Successfully added Revolutionary Tarot customer to Wix:', customerEmail);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function addToWixContacts(customerData) {
  try {
    // First, search for existing contact with this email
    const searchResponse = await fetch(`https://www.wixapis.com/crm/v3/contacts/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WIX_API_KEY}`,
        'Content-Type': 'application/json',
        'wix-site-id': process.env.WIX_SITE_ID
      },
      body: JSON.stringify({
        search: {
          filter: {
            "info.emails.email": {
              "$eq": customerData.email
            }
          }
        }
      })
    });

    if (!searchResponse.ok) {
      const errorData = await searchResponse.text();
      throw new Error(`Wix search error: ${searchResponse.status} - ${errorData}`);
    }

    const searchResult = await searchResponse.json();
    const existingContact = searchResult.contacts && searchResult.contacts.length > 0 ? searchResult.contacts[0] : null;

    if (existingContact) {
      // Update existing contact - add the label if not already present
      const currentLabels = existingContact.info.labelKeys || [];
      const newLabel = "Stripe MTHD RT 2025";
      
      if (!currentLabels.includes(newLabel)) {
        currentLabels.push(newLabel);
        
        const updateData = {
          info: {
            labelKeys: currentLabels
          }
        };

        // Add custom fields
        if (customerData.purchaseAmount) {
          updateData.info.extendedFields = {
            "custom.lastPurchaseAmount": customerData.purchaseAmount.toString(),
            "custom.lastPurchaseDate": customerData.purchaseDate,
            "custom.stripeSessionId": customerData.stripeSessionId
          };
        }

        const updateResponse = await fetch(`https://www.wixapis.com/crm/v3/contacts/${existingContact.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${process.env.WIX_API_KEY}`,
            'Content-Type': 'application/json',
            'wix-site-id': process.env.WIX_SITE_ID
          },
          body: JSON.stringify(updateData)
        });

        if (!updateResponse.ok) {
          const errorData = await updateResponse.text();
          throw new Error(`Wix update error: ${updateResponse.status} - ${errorData}`);
        }

        const result = await updateResponse.json();
        console.log('Updated existing contact in Wix:', result);
        return result;
      } else {
        console.log('Contact already has the label, no update needed');
        return { message: 'Contact already tagged' };
      }
    } else {
      // Create new contact
      const contactData = {
        info: {
          name: {
            first: customerData.firstName,
            last: customerData.lastName
          },
          emails: [
            {
              email: customerData.email,
              primary: true
            }
          ],
          phones: customerData.phone ? [
            {
              phone: customerData.phone,
              primary: true
            }
          ] : [],
          labelKeys: ["Stripe MTHD RT 2025"]
        }
      };

      // Add custom fields
      if (customerData.purchaseAmount) {
        contactData.info.extendedFields = {
          "custom.lastPurchaseAmount": customerData.purchaseAmount.toString(),
          "custom.lastPurchaseDate": customerData.purchaseDate,
          "custom.stripeSessionId": customerData.stripeSessionId
        };
      }

      const createResponse = await fetch('https://www.wixapis.com/crm/v3/contacts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.WIX_API_KEY}`,
          'Content-Type': 'application/json',
          'wix-site-id': process.env.WIX_SITE_ID
        },
        body: JSON.stringify(contactData)
      });

      if (!createResponse.ok) {
        const errorData = await createResponse.text();
        throw new Error(`Wix create error: ${createResponse.status} - ${errorData}`);
      }

      const result = await createResponse.json();
      console.log('Created new contact in Wix:', result);
      return result;
    }
    
  } catch (error) {
    console.error('Error managing contact in Wix:', error);
    throw error;
  }
}
