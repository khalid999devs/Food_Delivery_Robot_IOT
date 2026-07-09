import { useEffect, useMemo, useState } from 'react';
import {
  forceOrderProgress,
  getCurrentOrder,
  getDevices,
  getHealth,
  markCurrentOrderDeliveryReceived,
  runDispenseAndDeliverOrder,
} from './api.js';

const products = [
  {
    id: 'lemon',
    name: 'Lemon Cream',
    note: 'Bright citrus cream biscuits',
    price: 10,
    a: 1,
    b: 0,
    imageClass: 'lemon',
  },
  {
    id: 'chocolate',
    name: 'Chocolate Crunch',
    note: 'Cocoa sandwich biscuits',
    price: 12,
    a: 0,
    b: 1,
    imageClass: 'chocolate',
  },
  {
    id: 'duo',
    name: 'Duo Snack Pack',
    note: 'One lemon and one chocolate',
    price: 20,
    a: 1,
    b: 1,
    imageClass: 'duo',
  },
];
const MAX_PRODUCT_QUANTITY = 3;

const stations = [
  { value: 'station_1', label: 'Station 1' },
  { value: 'station_2', label: 'Station 2' },
  { value: 'station_3', label: 'Station 3' },
  { value: 'station_4', label: 'Station 4' },
];

const activeStatuses = new Set([
  'created',
  'robot_prepare_sent',
  'robot_ready',
  'vending_dispense_sent',
  'vending_accepted',
  'vending_dispensing',
  'vending_progress',
  'vending_completed',
  'robot_load_confirmation_sent',
  'robot_loaded',
  'robot_delivery_sent',
  'robot_delivering',
  'blocked_by_obstacle',
  'station_reached',
  'awaiting_delivery_receipt',
  'delivery_received',
]);

const progressSteps = [
  {
    label: 'Order accepted',
    statuses: ['created', 'robot_prepare_sent', 'robot_ready'],
  },
  {
    label: 'Preparing snacks',
    statuses: [
      'vending_dispense_sent',
      'vending_accepted',
      'vending_dispensing',
      'vending_progress',
      'vending_completed',
      'robot_load_confirmation_sent',
      'robot_loaded',
    ],
  },
  {
    label: 'On the way',
    statuses: [
      'robot_delivery_sent',
      'robot_delivering',
      'blocked_by_obstacle',
    ],
  },
  {
    label: 'Arrived',
    statuses: [
      'station_reached',
      'awaiting_delivery_receipt',
      'delivery_received',
      'completed',
    ],
  },
];

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location is unavailable in this browser'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        resolve({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
          capturedAt: new Date().toISOString(),
        }),
      (error) =>
        reject(new Error(error.message || 'Could not read your location')),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  });
}

function getLaneTotals(cart) {
  return products.reduce(
    (totals, product) => {
      const quantity = cart[product.id] || 0;
      totals.a += product.a * quantity;
      totals.b += product.b * quantity;
      totals.price += product.price * quantity;
      totals.items += quantity;
      return totals;
    },
    { a: 0, b: 0, price: 0, items: 0 },
  );
}

function orderStepIndex(status) {
  return progressSteps.findIndex((step) => step.statuses.includes(status));
}

function ConsumerStorefront({ onAdmin }) {
  const [health, setHealth] = useState(null);
  const [devices, setDevices] = useState({});
  const [order, setOrder] = useState(null);
  const [cart, setCart] = useState({});
  const [station, setStation] = useState('station_1');
  const [userLocation, setUserLocation] = useState(null);
  const [locationState, setLocationState] = useState('idle');
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [paymentOpen, setPaymentOpen] = useState(false);

  const robot = devices.robot_car_001;
  const vending = devices.vending_001;
  const totals = useMemo(() => getLaneTotals(cart), [cart]);
  const activeOrder = order && activeStatuses.has(order.status);
  const shopReady = Boolean(
    health?.mqttConnected && robot?.online && vending?.online,
  );

  async function refresh() {
    const results = await Promise.allSettled([
      getHealth(),
      getDevices(),
      getCurrentOrder(),
    ]);

    if (results[0].status === 'fulfilled') setHealth(results[0].value);
    if (results[1].status === 'fulfilled')
      setDevices(results[1].value.devices || {});
    if (results[2].status === 'fulfilled')
      setOrder(results[2].value.order || null);

    const failed = results.find((result) => result.status === 'rejected');
    setError(
      failed ? failed.reason.data?.message || failed.reason.message : '',
    );
  }

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 3000);
    return () => window.clearInterval(interval);
  }, []);

  function canAdd(product) {
    return (cart[product.id] || 0) < MAX_PRODUCT_QUANTITY;
  }

  function addProduct(product) {
    if (!canAdd(product) || activeOrder) return;
    setCart((current) => ({
      ...current,
      [product.id]: (current[product.id] || 0) + 1,
    }));
  }

  function removeProduct(productId) {
    setCart((current) => ({
      ...current,
      [productId]: Math.max(0, (current[productId] || 0) - 1),
    }));
  }

  async function captureLocation() {
    setLocationState('loading');
    try {
      const location = await getLocation();
      setUserLocation(location);
      setLocationState('ready');
      return location;
    } catch (locationError) {
      setUserLocation(null);
      setLocationState('error');
      setError(`${locationError.message}. You can still use a fixed station.`);
      return null;
    }
  }

  function selectStation(value) {
    setStation(value);
    captureLocation();
  }

  function openPayment() {
    if (!totals.items || activeOrder) return;
    setPaymentOpen(true);
  }

  async function confirmPaymentAndPlaceOrder() {
    if (!totals.items || activeOrder) return;
    setPaymentOpen(false);
    setLoading('order');
    setError('');

    try {
      const location = userLocation || (await captureLocation());
      await runDispenseAndDeliverOrder(totals.a, totals.b, station, location);
      setCart({});
      await refresh();
    } catch (requestError) {
      setError(requestError.data?.message || requestError.message);
    } finally {
      setLoading('');
    }
  }

  async function confirmDelivery() {
    setLoading('received');
    setError('');
    try {
      await markCurrentOrderDeliveryReceived();
      await refresh();
    } catch (requestError) {
      setError(requestError.data?.message || requestError.message);
    } finally {
      setLoading('');
    }
  }

  async function forceProgressStep(step) {
    if (!order?.orderId || loading) return;
    setLoading(`progress-${step}`);
    setError('');

    try {
      const response = await forceOrderProgress(order.orderId, step);
      setOrder(response.order);
    } catch (requestError) {
      setError(requestError.data?.message || requestError.message);
    } finally {
      setLoading('');
    }
  }

  const currentStep = orderStepIndex(order?.status);

  return (
    <main className='storefront'>
      <header className='store-nav'>
        <button
          type='button'
          className='store-brand'
          onClick={() => window.scrollTo(0, 0)}
        >
          <span>SR</span>
          <strong>SnackRoute</strong>
        </button>
        <div className='store-nav-actions'>
          <span className={`shop-state ${shopReady ? 'ready' : ''}`}>
            {shopReady ? 'Ready to order' : 'Service checking'}
          </span>
          <button type='button' className='admin-link' onClick={onAdmin}>
            Admin
          </button>
        </div>
      </header>

      <section className='store-intro'>
        <div>
          <p className='store-kicker'>Smart vending delivery</p>
          <h1>Pick a snack. We bring it over.</h1>
          <p>
            Choose a pack and your station. The vending machine and delivery
            robot handle the rest.
          </p>
        </div>
        <div className='service-facts'>
          <div>
            <strong>4</strong>
            <span>Delivery stations</span>
          </div>
          <div>
            <strong>Live</strong>
            <span>Order progress</span>
          </div>
        </div>
      </section>

      {error ? (
        <div className='store-error' role='alert'>
          {error}
        </div>
      ) : null}

      {activeOrder ? (
        <section className='order-tracker'>
          <div className='tracker-heading'>
            <div>
              <p className='store-kicker'>Order {order.orderId}</p>
              <h2>Your snacks are in motion</h2>
            </div>
            <strong>
              {
                stations.find((item) => item.value === order.targetStation)
                  ?.label
              }
            </strong>
          </div>
          <div className='consumer-progress'>
            {progressSteps.map((step, index) => (
              <button
                type='button'
                key={step.label}
                className={[
                  index <= currentStep ? 'complete' : '',
                  loading === `progress-${index + 1}` ? 'is-updating' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => forceProgressStep(index + 1)}
                disabled={Boolean(loading)}
                title={`Force demo progress to ${step.label}`}
                aria-label={`Force order progress to ${step.label}`}
              >
                <span>{index < currentStep ? '✓' : index + 1}</span>
                <strong>{step.label}</strong>
              </button>
            ))}
          </div>
          {order.status === 'blocked_by_obstacle' ? (
            <div className='consumer-warning'>
              Delivery paused safely while the path is blocked.
            </div>
          ) : null}
          {order.status === 'awaiting_delivery_receipt' ? (
            <button
              type='button'
              className={`consumer-received ${loading === 'received' ? 'is-loading' : ''}`}
              onClick={confirmDelivery}
              disabled={Boolean(loading)}
            >
              {loading === 'received'
                ? 'Confirming...'
                : 'I received my delivery'}
            </button>
          ) : null}
        </section>
      ) : (
        <div className='store-layout'>
          <section className='catalog-section'>
            <div className='section-heading'>
              <div>
                <p className='store-kicker'>Available now</p>
                <h2>Choose your snack</h2>
              </div>
              <span>৳10–৳20</span>
            </div>
            <div className='product-grid'>
              {products.map((product) => {
                const available = canAdd(product);
                return (
                  <article className='product-card' key={product.id}>
                    <div
                      className={`product-photo ${product.imageClass}`}
                      role='img'
                      aria-label={product.name}
                    />
                    <div className='product-info'>
                      <div>
                        <h3>{product.name}</h3>
                        <p>{product.note}</p>
                        <span className='product-availability'>
                          Available · max 3
                        </span>
                      </div>
                      <strong>৳{product.price}</strong>
                    </div>
                    <button
                      type='button'
                      onClick={() => addProduct(product)}
                      disabled={!available}
                    >
                      {available ? 'Add to order' : 'Maximum 3 selected'}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>

          <aside className='checkout-panel'>
            <div className='checkout-heading'>
              <h2>Your order</h2>
              <span>
                {totals.items} item{totals.items === 1 ? '' : 's'}
              </span>
            </div>
            <div className='cart-lines'>
              {products
                .filter((product) => cart[product.id])
                .map((product) => (
                  <div className='cart-line' key={product.id}>
                    <div>
                      <strong>{product.name}</strong>
                      <span>৳{product.price} each</span>
                    </div>
                    <div className='cart-stepper'>
                      <button
                        type='button'
                        onClick={() => removeProduct(product.id)}
                        aria-label={`Remove ${product.name}`}
                      >
                        −
                      </button>
                      <strong>{cart[product.id]}</strong>
                      <button
                        type='button'
                        onClick={() => addProduct(product)}
                        disabled={!canAdd(product)}
                        aria-label={`Add ${product.name}`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              {!totals.items ? (
                <p className='empty-cart'>
                  Your selected snacks will appear here.
                </p>
              ) : null}
            </div>

            <div className='consumer-stations'>
              <span>Deliver to</span>
              <div>
                {stations.map((item) => (
                  <button
                    type='button'
                    key={item.value}
                    className={station === item.value ? 'selected' : ''}
                    onClick={() => selectStation(item.value)}
                  >
                    {item.label.replace('Station ', '')}
                  </button>
                ))}
              </div>
              <p className={locationState}>
                {locationState === 'loading'
                  ? 'Reading your location...'
                  : userLocation
                    ? 'Location attached to this order'
                    : locationState === 'error'
                      ? 'Using the selected fixed station'
                      : 'Tap a station to attach your location'}
              </p>
            </div>

            <div className='checkout-total'>
              <span>Total</span>
              <strong>৳{totals.price}</strong>
            </div>
            <button
              type='button'
              className={`place-order ${loading === 'order' ? 'is-loading' : ''}`}
              onClick={openPayment}
              disabled={!totals.items || Boolean(loading)}
            >
              {loading === 'order' ? 'Starting order...' : 'Place order'}
            </button>
            <p className='checkout-note'>
              A demo payment confirmation appears before ordering.
            </p>
          </aside>
        </div>
      )}

      {paymentOpen ? (
        <div
          className='payment-overlay'
          role='presentation'
          onMouseDown={() => setPaymentOpen(false)}
        >
          <section
            className='payment-dialog'
            role='dialog'
            aria-modal='true'
            aria-labelledby='payment-title'
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className='payment-heading'>
              <div>
                <p className='store-kicker'>Demo checkout</p>
                <h2 id='payment-title'>Confirm your payment</h2>
              </div>
              <button
                type='button'
                onClick={() => setPaymentOpen(false)}
                aria-label='Close payment'
              >
                ×
              </button>
            </div>

            <div className='demo-payment-method'>
              <span>Demo wallet</span>
              <strong>No real charge</strong>
            </div>

            <div className='payment-summary'>
              <div>
                <span>Items</span>
                <strong>{totals.items}</strong>
              </div>
              <div>
                <span>Delivery</span>
                <strong>
                  {stations.find((item) => item.value === station)?.label}
                </strong>
              </div>
              <div>
                <span>Total</span>
                <strong>৳{totals.price}</strong>
              </div>
            </div>

            {!shopReady ? (
              <div className='payment-warning'>
                Devices are not currently confirmed online. The real backend may
                reject or time out.
              </div>
            ) : null}

            <div className='payment-actions'>
              <button
                type='button'
                className='text-button'
                onClick={() => setPaymentOpen(false)}
              >
                Cancel
              </button>
              <button type='button' onClick={confirmPaymentAndPlaceOrder}>
                Confirm & place order
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default ConsumerStorefront;
