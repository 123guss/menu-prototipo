// ============================================================
// PROTOTIPO — Lógica del menú público + carrito
// Lee los platillos desde Firestore, permite personalizar cada
// platillo (cantidad, extras con costo, nota de "quitar algo"),
// guarda el pedido en Firestore, y abre WhatsApp con el desglose.
// ============================================================

const menuList = document.getElementById('menu-list');
const emptyState = document.getElementById('empty-state');
const loadingState = document.getElementById('loading-state');
const catScroll = document.getElementById('cat-scroll');

let allDishes = [];
let activeCategory = 'todos';

// cart: array de líneas. Cada línea es un platillo configurado.
// { lineId, dishId, name, basePrice, qty, extras: [{name, price}], removeNote }
let cart = [];

// --- Links de WhatsApp (header y footer) — solo para contacto general,
// ya no forman parte del flujo de hacer un pedido ---
const genericWhatsAppLink = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Hola! Quisiera ver el menú')}`;
document.getElementById('header-whatsapp').href = genericWhatsAppLink;
document.getElementById('footer-whatsapp').href = genericWhatsAppLink;

// --- Cargar platillos desde Firestore ---
let hasResolvedDishes = false;

function showDishes(dishes) {
  if (hasResolvedDishes) return;
  hasResolvedDishes = true;
  allDishes = dishes;
  loadingState.hidden = true;
  renderCategories();
  renderMenu();
}

function loadDishes() {
  // Salvavidas: si Firestore no responde en 4 segundos (llave inválida,
  // sin conexión, proyecto no configurado), dejamos de esperar y mostramos
  // el estado vacío — así el menú nunca se queda "Calentando…" para siempre.
  setTimeout(() => {
    if (!hasResolvedDishes) {
      console.warn('Firestore no respondió a tiempo.');
      showDishes([]);
    }
  }, 4000);

  try {
    db.collection('dishes')
      .orderBy('createdAt', 'desc')
      .onSnapshot(
        (snapshot) => {
          const fromFirestore = [];
          snapshot.forEach((doc) => {
            fromFirestore.push({ id: doc.id, ...doc.data() });
          });
          showDishes(fromFirestore);
        },
        (error) => {
          console.warn('No se pudo conectar a Firestore:', error);
          showDishes([]);
        }
      );
  } catch (err) {
    console.warn('Firebase no está configurado aún:', err);
    showDishes([]);
  }
}

function renderCategories() {
  const cats = [...new Set(allDishes.map(d => d.category).filter(Boolean))];

  catScroll.querySelectorAll('.cat-pill:not([data-cat="todos"])').forEach(el => el.remove());

  cats.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'cat-pill';
    btn.dataset.cat = cat;
    btn.textContent = cat;
    catScroll.appendChild(btn);
  });

  catScroll.querySelectorAll('.cat-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.cat;
      catScroll.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      renderMenu();
    });
  });
}

function renderMenu() {
  const filtered = activeCategory === 'todos'
    ? allDishes
    : allDishes.filter(d => d.category === activeCategory);

  menuList.innerHTML = '';

  if (filtered.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  filtered.forEach((dish, i) => {
    const card = document.createElement('div');
    card.className = 'dish-card';
    card.style.animationDelay = `${Math.min(i * 0.04, 0.3)}s`;
    const inCart = cart.some(line => line.dishId === dish.id);
    card.innerHTML = `
      <div class="dish-img">
        <img src="${dish.imageUrl}" alt="${escapeHtml(dish.name)}" loading="lazy">
        ${dish.category ? `<span class="dish-cat-tag">${escapeHtml(dish.category)}</span>` : ''}
      </div>
      <div class="dish-body">
        <div class="dish-info">
          <h3 class="dish-name">${escapeHtml(dish.name)}</h3>
          <p class="dish-price">Q${Number(dish.price).toFixed(2)}</p>
        </div>
        <button class="dish-add ${inCart ? 'is-in-cart' : ''}" data-id="${dish.id}" aria-label="Personalizar ${escapeHtml(dish.name)}">
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>
    `;
    card.addEventListener('click', () => openDishModal(dish));
    menuList.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ===================== MODAL DE PERSONALIZACIÓN =====================

const dishModalOverlay = document.getElementById('dish-modal-overlay');
const dishModalImg = document.getElementById('dish-modal-img');
const dishModalName = document.getElementById('dish-modal-name');
const dishModalPrice = document.getElementById('dish-modal-price');
const dishModalDesc = document.getElementById('dish-modal-desc');
const dishModalExtrasSection = document.getElementById('dish-modal-extras-section');
const dishModalExtras = document.getElementById('dish-modal-extras');
const dishModalRemove = document.getElementById('dish-modal-remove');
const dishModalQtyNum = document.getElementById('dish-modal-qty-num');
const dishModalTotal = document.getElementById('dish-modal-total');

let modalDish = null;
let modalQty = 1;
let modalSelectedExtras = new Set(); // índices de extras seleccionados

function openDishModal(dish) {
  modalDish = dish;
  modalQty = 1;
  modalSelectedExtras = new Set();

  dishModalImg.src = dish.imageUrl;
  dishModalImg.alt = dish.name;
  dishModalName.textContent = dish.name;
  dishModalPrice.textContent = `Q${Number(dish.price).toFixed(2)}`;
  dishModalDesc.textContent = dish.description || '';
  dishModalDesc.hidden = !dish.description;
  dishModalRemove.value = '';

  const extras = dish.extras || [];
  if (extras.length > 0) {
    dishModalExtrasSection.hidden = false;
    dishModalExtras.innerHTML = extras.map((extra, i) => `
      <label class="dish-modal-extra">
        <input type="checkbox" data-extra-index="${i}">
        <span class="dish-modal-extra-name">${escapeHtml(extra.name)}</span>
        <span class="dish-modal-extra-price">+Q${Number(extra.price).toFixed(2)}</span>
      </label>
    `).join('');
    dishModalExtras.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const idx = Number(checkbox.dataset.extraIndex);
        if (checkbox.checked) modalSelectedExtras.add(idx);
        else modalSelectedExtras.delete(idx);
        updateModalTotal();
      });
    });
  } else {
    dishModalExtrasSection.hidden = true;
    dishModalExtras.innerHTML = '';
  }

  updateModalQtyDisplay();
  updateModalTotal();
  dishModalOverlay.hidden = false;
}

function updateModalQtyDisplay() {
  dishModalQtyNum.textContent = modalQty;
}

function getModalExtrasTotal() {
  const extras = (modalDish && modalDish.extras) || [];
  let sum = 0;
  modalSelectedExtras.forEach((idx) => {
    sum += Number(extras[idx].price);
  });
  return sum;
}

function updateModalTotal() {
  if (!modalDish) return;
  const unitPrice = Number(modalDish.price) + getModalExtrasTotal();
  dishModalTotal.textContent = `Q${(unitPrice * modalQty).toFixed(2)}`;
}

document.getElementById('dish-modal-qty-minus').addEventListener('click', () => {
  if (modalQty > 1) {
    modalQty -= 1;
    updateModalQtyDisplay();
    updateModalTotal();
  }
});
document.getElementById('dish-modal-qty-plus').addEventListener('click', () => {
  modalQty += 1;
  updateModalQtyDisplay();
  updateModalTotal();
});

document.getElementById('dish-modal-add').addEventListener('click', () => {
  if (!modalDish) return;
  const extras = (modalDish.extras || []).filter((_, i) => modalSelectedExtras.has(i));

  cart.push({
    lineId: `${modalDish.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    dishId: modalDish.id,
    name: modalDish.name,
    basePrice: Number(modalDish.price),
    qty: modalQty,
    extras,
    removeNote: dishModalRemove.value.trim(),
  });

  updateCartUI();
  renderMenu();
  closeDishModal();
});

function closeDishModal() {
  dishModalOverlay.hidden = true;
  modalDish = null;
}

document.getElementById('dish-modal-close').addEventListener('click', closeDishModal);
dishModalOverlay.addEventListener('click', (e) => {
  if (e.target === dishModalOverlay) closeDishModal();
});

// ===================== CARRITO =====================

function lineUnitPrice(line) {
  const extrasSum = (line.extras || []).reduce((sum, ex) => sum + Number(ex.price), 0);
  return line.basePrice + extrasSum;
}

function lineSubtotal(line) {
  return lineUnitPrice(line) * line.qty;
}

function changeLineQty(lineId, delta) {
  const line = cart.find((l) => l.lineId === lineId);
  if (!line) return;
  line.qty += delta;
  if (line.qty <= 0) {
    cart = cart.filter((l) => l.lineId !== lineId);
  }
  updateCartUI();
  renderMenu();
  renderCartItems();
}

function removeLine(lineId) {
  cart = cart.filter((l) => l.lineId !== lineId);
  updateCartUI();
  renderMenu();
  renderCartItems();
}

function getCartCount() {
  return cart.reduce((sum, line) => sum + line.qty, 0);
}

function getCartTotal() {
  return cart.reduce((sum, line) => sum + lineSubtotal(line), 0);
}

const cartCountEl = document.getElementById('cart-count');
const cartFooter = document.getElementById('cart-footer');
const cartEmpty = document.getElementById('cart-empty');
const cartTotal = document.getElementById('cart-total');

function updateCartUI() {
  const count = getCartCount();
  cartCountEl.textContent = count;
  cartCountEl.hidden = count === 0;

  const hasItems = count > 0;
  cartEmpty.hidden = hasItems;
  cartFooter.hidden = !hasItems;

  if (hasItems) {
    cartTotal.textContent = `Q${getCartTotal().toFixed(2)}`;
  }

  // Si el cliente ya escribió un monto de pago y el total cambió
  // (agregó/quitó algo), revalidamos para que el mensaje de error
  // siga siendo correcto.
  if (typeof validatePayment === 'function' && document.getElementById('cart-payment')) {
    validatePayment();
  }
}

function renderCartItems() {
  const cartItemsEl = document.getElementById('cart-items');
  cartItemsEl.innerHTML = '';

  cart.forEach((line) => {
    const row = document.createElement('div');
    row.className = 'cart-item';
    const extrasText = (line.extras || []).map(ex => ex.name).join(', ');
    row.innerHTML = `
      <div>
        <p class="cart-item-name">${escapeHtml(line.name)}</p>
        <p class="cart-item-price">Q${lineUnitPrice(line).toFixed(2)} c/u${extrasText ? ` · ${escapeHtml(extrasText)}` : ''}</p>
        ${line.removeNote ? `<p class="cart-item-note">Sin: ${escapeHtml(line.removeNote)}</p>` : ''}
        <button class="cart-item-remove" data-id="${line.lineId}">Quitar del pedido</button>
      </div>
      <div class="cart-item-qty">
        <button class="cart-qty-btn" data-action="minus" data-id="${line.lineId}" aria-label="Quitar uno">−</button>
        <span class="cart-qty-num">${line.qty}</span>
        <button class="cart-qty-btn" data-action="plus" data-id="${line.lineId}" aria-label="Agregar uno">+</button>
      </div>
    `;
    cartItemsEl.appendChild(row);
  });

  cartItemsEl.querySelectorAll('.cart-qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const delta = btn.dataset.action === 'plus' ? 1 : -1;
      changeLineQty(btn.dataset.id, delta);
    });
  });

  cartItemsEl.querySelectorAll('.cart-item-remove').forEach(btn => {
    btn.addEventListener('click', () => removeLine(btn.dataset.id));
  });
}

// --- Abrir / cerrar carrito ---
const cartOverlay = document.getElementById('cart-overlay');

document.getElementById('cart-toggle').addEventListener('click', () => {
  renderCartItems();
  cartOverlay.hidden = false;
});
document.getElementById('cart-close').addEventListener('click', () => {
  cartOverlay.hidden = true;
});
cartOverlay.addEventListener('click', (e) => {
  if (e.target === cartOverlay) cartOverlay.hidden = true;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    cartOverlay.hidden = true;
    closeDishModal();
  }
});

// --- Enviar pedido: se guarda en Firestore para que el cajero lo vea
// en tiempo real. Ya no se abre WhatsApp — ese botón quedó solo como
// contacto general en el header/footer. ---
const cartSubmit = document.getElementById('cart-submit');
const cartNote = document.getElementById('cart-note');
const cartPayment = document.getElementById('cart-payment');
const cartPaymentHint = document.getElementById('cart-payment-hint');

// El campo de pago es opcional, pero si tiene un valor, debe ser un
// número válido y mayor o igual al total del pedido (no tiene sentido
// que alguien diga que paga con un billete menor a lo que debe).
function validatePayment() {
  const raw = cartPayment.value.trim();
  if (raw === '') {
    cartPaymentHint.hidden = true;
    return { valid: true, amount: null };
  }

  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) {
    cartPaymentHint.textContent = 'Escribe solo el monto en números (ej. 100).';
    cartPaymentHint.hidden = false;
    return { valid: false, amount: null };
  }

  const total = getCartTotal();
  if (amount < total) {
    cartPaymentHint.textContent = `El billete debe ser de al menos Q${total.toFixed(2)} (el total del pedido).`;
    cartPaymentHint.hidden = false;
    return { valid: false, amount: null };
  }

  cartPaymentHint.hidden = true;
  return { valid: true, amount };
}

cartPayment.addEventListener('input', validatePayment);

// Guarda el pedido en Firestore para que aparezca en el tablero del
// cajero, y devuelve el ID del documento creado (o null si falló).
async function saveOrderToFirestore(paymentAmount) {
  const items = cart.map((line) => ({
    name: line.name,
    qty: line.qty,
    price: lineUnitPrice(line),
    extras: line.extras || [],
    removeNote: line.removeNote || '',
  }));

  try {
    const docRef = await db.collection('orders').add({
      items,
      total: getCartTotal(),
      paymentNote: paymentAmount !== null ? `Q${paymentAmount}` : '',
      note: cartNote.value.trim(),
      customerName: cartCustomerName.value.trim(),
      customerKey: normalizeCustomerKey(cartCustomerName.value),
      status: 'pendiente',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return docRef.id;
  } catch (err) {
    console.error('No se pudo guardar el pedido:', err);
    return null;
  }
}

// ===================== IDENTIDAD DEL CLIENTE =====================
// Para que "Mis pedidos" funcione, necesitamos una forma estable de
// identificar al mismo cliente entre visitas. Usamos lo que escribe en
// "Tu nombre y teléfono", normalizado (minúsculas, sin espacios extra)
// como clave — se guarda en localStorage y se autocompleta después.
const CUSTOMER_KEY_STORAGE = 'customerIdentity';

function normalizeCustomerKey(raw) {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

function getSavedCustomerName() {
  try {
    return localStorage.getItem(CUSTOMER_KEY_STORAGE) || '';
  } catch (err) {
    return '';
  }
}

function saveCustomerName(name) {
  try {
    localStorage.setItem(CUSTOMER_KEY_STORAGE, name);
  } catch (err) { /* noop */ }
}

const cartCustomerName = document.getElementById('cart-customer-name');
cartCustomerName.value = getSavedCustomerName();

// ===================== COOLDOWN ANTI-SPAM =====================
// Evita que el mismo cliente (mismo navegador) mande pedidos uno
// detrás de otro sin esperar — 3 minutos entre pedidos.
const ORDER_COOLDOWN_MS = 3 * 60 * 1000;
const LAST_ORDER_TIME_KEY = 'lastOrderSentAt';

function getCooldownRemaining() {
  try {
    const lastSent = Number(localStorage.getItem(LAST_ORDER_TIME_KEY) || 0);
    const remaining = ORDER_COOLDOWN_MS - (Date.now() - lastSent);
    return remaining > 0 ? remaining : 0;
  } catch (err) {
    return 0;
  }
}

function markOrderSentNow() {
  try {
    localStorage.setItem(LAST_ORDER_TIME_KEY, String(Date.now()));
  } catch (err) { /* noop */ }
}

cartSubmit.addEventListener('click', async (e) => {
  e.preventDefault();
  if (getCartCount() === 0) return;

  const cooldownLeft = getCooldownRemaining();
  if (cooldownLeft > 0) {
    const seconds = Math.ceil(cooldownLeft / 1000);
    if (window.showToast) {
      showToast({
        title: 'Espera un momento',
        message: `Puedes hacer otro pedido en ${seconds} segundo${seconds === 1 ? '' : 's'}.`,
        type: 'error',
      });
    }
    return;
  }

  if (!cartCustomerName.value.trim()) {
    if (window.showToast) {
      showToast({
        title: 'Falta tu nombre y teléfono',
        message: 'Lo necesitamos para identificar tu pedido.',
        type: 'error',
      });
    }
    cartCustomerName.focus();
    return;
  }

  const paymentCheck = validatePayment();
  if (!paymentCheck.valid) {
    cartPayment.focus();
    return;
  }

  cartSubmit.classList.add('is-sending');
  const orderId = await saveOrderToFirestore(paymentCheck.amount);
  cartSubmit.classList.remove('is-sending');

  if (!orderId) {
    if (window.showToast) {
      showToast({
        title: 'No se pudo enviar el pedido',
        message: 'Revisa tu conexión e intenta de nuevo.',
        type: 'error',
      });
    }
    return;
  }

  markOrderSentNow();
  saveCustomerName(cartCustomerName.value.trim());
  rememberMyOrder(orderId, getCartTotal());
  if (window.showToast) {
    showToast({
      title: 'Pedido enviado',
      message: 'El negocio ya lo puede ver. Puedes cancelarlo desde "Mi pedido" los próximos 10 minutos.',
      type: 'success',
    });
  }
  cart = [];
  cartNote.value = '';
  cartPayment.value = '';
  cartPaymentHint.hidden = true;
  updateCartUI();
  renderMenu();
  cartOverlay.hidden = true;
});

// ============================================================
// ============================================================
// "MI PEDIDO" — seguimiento en tiempo real y cancelación desde
// el navegador del cliente, sin necesitar cuenta. El ID del
// pedido se guarda en localStorage (solo este dispositivo debe
// poder cancelarlo), pero el estado se sigue en vivo desde
// Firestore para avisar si el cajero lo cambia (por ejemplo,
// si lo cancela él mismo).
// Ventana de cancelación: 10 minutos desde que se envió.
// ============================================================

const CANCEL_WINDOW_MS = 10 * 60 * 1000;
const MY_ORDER_KEY = 'lastOrder';

const ORDER_STATUS_LABEL = {
  pendiente: 'Pendiente',
  proceso: 'En proceso',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

let myOrderUnsubscribe = null;
let myOrderLastKnownStatus = null;
let cancelledByMe = false;

function rememberMyOrder(orderId, total) {
  const data = { orderId, total, sentAt: Date.now() };
  try {
    localStorage.setItem(MY_ORDER_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('No se pudo guardar el pedido en este dispositivo:', err);
  }
  showMyOrderButton(data);
  watchMyOrderStatus(orderId);
}

function getMyOrder() {
  try {
    const raw = localStorage.getItem(MY_ORDER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function clearMyOrder() {
  try {
    localStorage.removeItem(MY_ORDER_KEY);
  } catch (err) { /* noop */ }
}

let myOrderTickInterval = null;

function initMyOrderTracker() {
  const existing = getMyOrder();
  if (existing && Date.now() - existing.sentAt < CANCEL_WINDOW_MS + 5000) {
    // +5s de margen para que no desaparezca justo al recargar la página
    showMyOrderButton(existing);
  }
  if (existing) {
    watchMyOrderStatus(existing.orderId);
  }
}

// Escucha en tiempo real el documento del pedido para detectar si el
// cajero cambia su estado (avanzarlo o cancelarlo) mientras el cliente
// sigue en la página.
function watchMyOrderStatus(orderId) {
  if (myOrderUnsubscribe) myOrderUnsubscribe();
  myOrderLastKnownStatus = null;

  myOrderUnsubscribe = db.collection('orders').doc(orderId).onSnapshot((doc) => {
    if (!doc.exists) return;
    const status = doc.data().status;

    // No avisar en la primera lectura (sería redundante con el toast
    // de "pedido enviado" que ya se mostró al confirmar).
    if (myOrderLastKnownStatus === null) {
      myOrderLastKnownStatus = status;
      return;
    }

    if (status !== myOrderLastKnownStatus) {
      myOrderLastKnownStatus = status;
      announceStatusChange(status, cancelledByMe);
      cancelledByMe = false;

      if (status === 'cancelado') {
        document.getElementById('my-order-btn').hidden = true;
        if (myOrderTickInterval) clearInterval(myOrderTickInterval);
        clearMyOrder();
        if (myOrderUnsubscribe) myOrderUnsubscribe();
      }
    }
  });
}

function announceStatusChange(status, selfCancelled) {
  if (!window.showToast) return;
  const messages = {
    proceso: { title: 'Tu pedido está en preparación', type: 'info' },
    entregado: { title: 'Tu pedido fue entregado', message: 'Gracias por tu compra.', type: 'success' },
    cancelado: selfCancelled
      ? { title: 'Pedido cancelado', message: 'Le avisamos al negocio.', type: 'info' }
      : { title: 'Tu pedido fue cancelado', message: 'El negocio canceló tu pedido. Escríbenos si tienes dudas.', type: 'error' },
  };
  const config = messages[status];
  if (config) showToast(config);
}

function showMyOrderButton(data) {
  const btn = document.getElementById('my-order-btn');
  btn.hidden = false;
  tickMyOrderButton(data);

  if (myOrderTickInterval) clearInterval(myOrderTickInterval);
  myOrderTickInterval = setInterval(() => tickMyOrderButton(data), 1000);
}

function tickMyOrderButton(data) {
  const btn = document.getElementById('my-order-btn');
  const timeLeft = CANCEL_WINDOW_MS - (Date.now() - data.sentAt);

  if (timeLeft <= 0) {
    btn.hidden = true;
    clearInterval(myOrderTickInterval);
    return;
  }

  const mins = Math.floor(timeLeft / 60000);
  const secs = Math.floor((timeLeft % 60000) / 1000);
  document.getElementById('my-order-timer').textContent =
    `${mins}:${secs.toString().padStart(2, '0')}`;
}

document.getElementById('my-order-btn').addEventListener('click', () => {
  const data = getMyOrder();
  if (!data) return;
  openCancelConfirm(data);
});

// --- Confirmación de cancelación ---
const cancelConfirmOverlay = document.getElementById('cancel-confirm-overlay');

function openCancelConfirm(data) {
  cancelConfirmOverlay.hidden = false;
}

document.getElementById('cancel-confirm-no').addEventListener('click', () => {
  cancelConfirmOverlay.hidden = true;
});

document.getElementById('cancel-confirm-yes').addEventListener('click', async () => {
  const data = getMyOrder();
  cancelConfirmOverlay.hidden = true;
  if (!data) return;

  const timeLeft = CANCEL_WINDOW_MS - (Date.now() - data.sentAt);
  if (timeLeft <= 0) {
    if (window.showToast) {
      showToast({ title: 'Ya no se puede cancelar', message: 'Pasaron más de 10 minutos.', type: 'error' });
    }
    document.getElementById('my-order-btn').hidden = true;
    clearInterval(myOrderTickInterval);
    clearMyOrder();
    return;
  }

  try {
    // Marcamos que esta cancelación la inició el cliente, para que el
    // listener en tiempo real (watchMyOrderStatus) muestre el mensaje
    // correcto y no el de "el negocio canceló tu pedido".
    cancelledByMe = true;
    await db.collection('orders').doc(data.orderId).update({ status: 'cancelado' });
  } catch (err) {
    console.error('No se pudo cancelar el pedido:', err);
    cancelledByMe = false;
    if (window.showToast) {
      showToast({ title: 'No se pudo cancelar', message: 'Intenta de nuevo en un momento.', type: 'error' });
    }
  }
});

// ============================================================
// "MIS PEDIDOS" — historial de pedidos del mismo cliente
// (identificado por nombre/teléfono guardado en su navegador),
// con estado en tiempo real para cada uno.
// ============================================================

const myOrdersOverlay = document.getElementById('my-orders-overlay');
const myOrdersList = document.getElementById('my-orders-list');
const myOrdersEmpty = document.getElementById('my-orders-empty');
let myOrdersUnsubscribe = null;

document.getElementById('my-orders-toggle').addEventListener('click', () => {
  const savedName = getSavedCustomerName();
  if (!savedName) {
    if (window.showToast) {
      showToast({
        title: 'Todavía no tienes pedidos',
        message: 'Haz tu primer pedido y vas a poder verlo aquí.',
        type: 'info',
      });
    }
    return;
  }
  openMyOrders(savedName);
});

document.getElementById('my-orders-close').addEventListener('click', () => {
  myOrdersOverlay.hidden = true;
});
myOrdersOverlay.addEventListener('click', (e) => {
  if (e.target === myOrdersOverlay) myOrdersOverlay.hidden = true;
});

function openMyOrders(name) {
  myOrdersOverlay.hidden = false;
  const key = normalizeCustomerKey(name);

  if (myOrdersUnsubscribe) myOrdersUnsubscribe();

  myOrdersUnsubscribe = db.collection('orders')
    .where('customerKey', '==', key)
    .orderBy('createdAt', 'desc')
    .limit(20)
    .onSnapshot(
      (snapshot) => {
        const orders = [];
        snapshot.forEach((doc) => orders.push({ id: doc.id, ...doc.data() }));
        renderMyOrdersList(orders);
      },
      (error) => {
        console.error('No se pudieron cargar tus pedidos:', error);
        myOrdersList.innerHTML = '';
        myOrdersEmpty.hidden = false;
        myOrdersEmpty.querySelector('p').textContent = 'No se pudieron cargar tus pedidos.';
      }
    );
}

function renderMyOrdersList(orders) {
  myOrdersList.innerHTML = '';

  if (orders.length === 0) {
    myOrdersEmpty.hidden = false;
    return;
  }
  myOrdersEmpty.hidden = true;

  orders.forEach((order) => {
    const card = document.createElement('div');
    card.className = 'my-order-card';

    const time = order.createdAt && order.createdAt.toDate
      ? order.createdAt.toDate().toLocaleString('es-GT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '';

    const itemsText = (order.items || []).map(item => `${item.qty}x ${item.name}`).join(', ');
    const status = order.status || 'pendiente';

    card.innerHTML = `
      <div class="my-order-card-top">
        <span class="my-order-status my-order-status-${status}">${ORDER_STATUS_LABEL[status] || status}</span>
        <span class="my-order-time">${time}</span>
      </div>
      <p class="my-order-items">${escapeHtml(itemsText)}</p>
      <p class="my-order-total">Q${Number(order.total).toFixed(2)}</p>
    `;
    myOrdersList.appendChild(card);
  });
}

// --- Iniciar ---
updateCartUI();
loadDishes();
initMyOrderTracker();
