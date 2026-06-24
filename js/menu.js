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

// --- Platillos de muestra (solo para que el demo no se vea vacío) ---
const SAMPLE_DISHES = [
  { id: 'sample-1', name: 'Res con vegetales al wok', price: 65, category: 'Platos fuertes', description: 'Res tierna salteada con brócoli, pimiento y zanahoria en salsa de la casa.', imageUrl: 'assets/dishes/dish-3.jpg', extras: [{ name: 'Bebida', price: 12 }, { name: 'Arroz extra', price: 8 }] },
  { id: 'sample-2', name: 'Res salteada con brócoli', price: 58, category: 'Platos fuertes', description: 'Un clásico: res jugosa con brócoli fresco y un toque de ajo.', imageUrl: 'assets/dishes/dish-1.jpg', extras: [{ name: 'Bebida', price: 12 }] },
  { id: 'sample-3', name: 'Res a la plancha con guarnición', price: 62, category: 'Platos fuertes', description: 'Servida con vegetales de temporada salteados al punto.', imageUrl: 'assets/dishes/dish-2.jpg', extras: [] },
  { id: 'sample-4', name: 'Tabla mixta de vegetales y res', price: 70, category: 'Para compartir', description: 'Porción generosa, ideal para compartir.', imageUrl: 'assets/dishes/dish-4.jpg', extras: [{ name: 'Tortillas extra', price: 5 }] },
  { id: 'sample-5', name: 'Res al estilo de la casa', price: 60, category: 'Platos fuertes', description: 'La receta de siempre, con la sazón que nos identifica.', imageUrl: 'assets/dishes/dish-5.jpg', extras: [] },
  { id: 'sample-6', name: 'Bocados de res con palillos', price: 55, category: 'Entradas', description: 'Porción individual, perfecta para picar.', imageUrl: 'assets/dishes/dish-6.jpg', extras: [{ name: 'Bebida', price: 12 }] },
];

// --- Links de WhatsApp (header y footer) — solo para contacto general,
// ya no forman parte del flujo de hacer un pedido ---
const genericWhatsAppLink = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Hola! Quisiera ver el menú 🍲')}`;
document.getElementById('header-whatsapp').href = genericWhatsAppLink;
document.getElementById('footer-whatsapp').href = genericWhatsAppLink;

// --- Cargar platillos desde Firestore (con muestra como respaldo) ---
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
  // sin conexión, proyecto no configurado), mostramos las muestras y
  // dejamos de esperar — así el demo nunca se queda cargando para siempre.
  setTimeout(() => {
    if (!hasResolvedDishes) {
      console.warn('Firestore no respondió a tiempo, usando platillos de muestra.');
      showDishes(SAMPLE_DISHES);
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
          showDishes(fromFirestore.length > 0 ? fromFirestore : SAMPLE_DISHES);
        },
        (error) => {
          console.warn('No se pudo conectar a Firestore, usando platillos de muestra:', error);
          showDishes(SAMPLE_DISHES);
        }
      );
  } catch (err) {
    console.warn('Firebase no está configurado aún, usando platillos de muestra:', err);
    showDishes(SAMPLE_DISHES);
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

// Guarda el pedido en Firestore para que aparezca en el tablero del
// cajero, y devuelve el ID del documento creado (o null si falló).
async function saveOrderToFirestore() {
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
      paymentNote: cartPayment.value.trim(),
      note: cartNote.value.trim(),
      status: 'pendiente',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return docRef.id;
  } catch (err) {
    console.error('No se pudo guardar el pedido:', err);
    return null;
  }
}

cartSubmit.addEventListener('click', async (e) => {
  e.preventDefault();
  if (getCartCount() === 0) return;

  cartSubmit.classList.add('is-sending');
  const orderId = await saveOrderToFirestore();
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
  updateCartUI();
  renderMenu();
  cartOverlay.hidden = true;
});

// ============================================================
// "MI PEDIDO" — seguimiento y cancelación desde el navegador
// del cliente, sin necesitar cuenta. Se guarda en localStorage
// porque solo este dispositivo debe poder cancelar este pedido.
// Ventana de cancelación: 10 minutos desde que se envió.
// ============================================================

const CANCEL_WINDOW_MS = 10 * 60 * 1000;
const MY_ORDER_KEY = 'lastOrder';

function rememberMyOrder(orderId, total) {
  const data = { orderId, total, sentAt: Date.now() };
  try {
    localStorage.setItem(MY_ORDER_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('No se pudo guardar el pedido en este dispositivo:', err);
  }
  showMyOrderButton(data);
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
    clearMyOrder();
    return;
  }

  try {
    await db.collection('orders').doc(data.orderId).update({ status: 'cancelado' });
    if (window.showToast) {
      showToast({ title: 'Pedido cancelado', message: 'Le avisamos al negocio.', type: 'info' });
    }
  } catch (err) {
    console.error('No se pudo cancelar el pedido:', err);
    if (window.showToast) {
      showToast({ title: 'No se pudo cancelar', message: 'Intenta de nuevo en un momento.', type: 'error' });
    }
  }

  document.getElementById('my-order-btn').hidden = true;
  clearInterval(myOrderTickInterval);
  clearMyOrder();
});

// --- Iniciar ---
updateCartUI();
loadDishes();
initMyOrderTracker();
