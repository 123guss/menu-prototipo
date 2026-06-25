// lógica del menú público + carrito
// lee platillos de firestore, deja personalizar cada uno (cantidad, extras, notas),
// guarda el pedido en firestore

const menuList = document.getElementById('menu-list');
const emptyState = document.getElementById('empty-state');
const loadingState = document.getElementById('loading-state');
const catScroll = document.getElementById('cat-scroll');

// bloquea el scroll del body cuando hay un overlay abierto
// sin esto, en celular el drawer se siente trabado porque el fondo también scrollea
// uso contador porque a veces hay un modal encima de otro (cancelar encima del panel)
let bodyScrollLockCount = 0;
function lockBodyScroll() {
  bodyScrollLockCount += 1;
  document.body.style.overflow = 'hidden';
}
function unlockBodyScroll() {
  bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
  if (bodyScrollLockCount === 0) {
    document.body.style.overflow = '';
  }
}

let allDishes = [];
let allCategoryNames = [];
let activeCategory = 'todos';

// foto de respaldo si la del platillo no carga (url rota, cloudinary caído, etc)
// es un svg metido directo aquí para que nunca dependa de otro archivo
const FALLBACK_DISH_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%232B2017'/%3E%3Ccircle cx='100' cy='90' r='38' fill='none' stroke='%238C7A65' stroke-width='3'/%3E%3Cpath d='M70 150h60M85 130v25M115 130v25' stroke='%238C7A65' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E";

// info del negocio (colección "restaurant", documento "info")
// si el negocio configuró esto en firestore, sobreescribe nombre/whatsapp/horario
// si no existe, no pasa nada, se queda el placeholder de siempre
let restaurantInfo = null;

function applyRestaurantInfo(data) {
  if (!data) return;
  restaurantInfo = data;

  if (data.name) {
    document.querySelectorAll('.brand-name, .footer-name').forEach((el) => {
      el.textContent = data.name;
    });
    document.title = data.name;
  }

  if (data.whatsapp) {
    const link = `https://wa.me/${data.whatsapp}?text=${encodeURIComponent('Hola! Quisiera ver el menú')}`;
    const headerLink = document.getElementById('header-whatsapp');
    const footerLink = document.getElementById('footer-whatsapp');
    if (headerLink) headerLink.href = link;
    if (footerLink) footerLink.href = link;
  }

  // Si el negocio está marcado como cerrado, mostramos un aviso fijo
  // y bloqueamos el envío de pedidos — pero el menú sigue siendo
  // visible (el cliente puede ver qué hay, solo no puede pedir ahora).
  if (data.isOpen === false) {
    showClosedBanner(data.schedule);
  }
}

function showClosedBanner(schedule) {
  if (document.getElementById('closed-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'closed-banner';
  banner.className = 'closed-banner';
  banner.innerHTML = `
    <span>Estamos cerrados en este momento.</span>
    ${schedule ? `<span class="closed-banner-schedule">${escapeHtml(schedule)}</span>` : ''}
  `;
  document.body.prepend(banner);
}

function loadRestaurantInfo() {
  try {
    db.collection('restaurant').doc('info').get()
      .then((doc) => {
        if (doc.exists) applyRestaurantInfo(doc.data());
      })
      .catch((err) => {
        console.warn('No se pudo cargar la info del negocio (usando valores por defecto):', err);
      });
  } catch (err) {
    console.warn('Firebase no está configurado aún:', err);
  }
}

// cart: array de líneas. Cada línea es un platillo configurado.
// { lineId, dishId, name, basePrice, qty, extras: [{name, price}], removeNote }
let cart = [];

// links de whatsapp del header y footer, solo para contactar, ya no se usan para pedir
const genericWhatsAppLink = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Hola! Quisiera ver el menú')}`;
document.getElementById('header-whatsapp').href = genericWhatsAppLink;
document.getElementById('footer-whatsapp').href = genericWhatsAppLink;

// carga los platillos de firestore
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
            const dish = { id: doc.id, ...doc.data() };
            // Solo mostramos al cliente platillos activos. Un platillo
            // pausado (active: false) sigue existiendo y editable en el
            // panel, pero no aparece en el menú público mientras esté así.
            if (dish.active !== false) fromFirestore.push(dish);
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

function loadCategoryNames() {
  try {
    db.collection('categories')
      .orderBy('useCount', 'desc')
      .onSnapshot(
        (snapshot) => {
          allCategoryNames = [];
          snapshot.forEach((doc) => allCategoryNames.push(doc.data().name));
          renderCategories();
        },
        (error) => {
          console.warn('No se pudieron cargar las categorías:', error);
        }
      );
  } catch (err) {
    console.warn('Firebase no está configurado aún:', err);
  }
}

const UNCATEGORIZED = 'Sin categoría';

function renderCategories() {
  // Mostramos todas las categorías conocidas del negocio (aunque estén
  // vacías), más cualquier categoría que solo exista en algún platillo
  // (por compatibilidad si la colección de categorías no está sincronizada).
  // "Sin categoría" es un cajón interno del panel del cajero — el cliente
  // nunca debe verlo como una categoría real del menú.
  const fromDishes = allDishes.map(d => d.category).filter(Boolean);
  const cats = [...new Set([...allCategoryNames, ...fromDishes])]
    .filter((cat) => cat !== UNCATEGORIZED);

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
    const photos = getDishPhotos(dish);
    card.innerHTML = `
      <div class="dish-img">
        <img src="${photos[0] || FALLBACK_DISH_IMAGE}" alt="${escapeHtml(dish.name)}" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK_DISH_IMAGE}';">
        ${photos.length > 1 ? `<span class="dish-photo-count">${photos.length} fotos</span>` : ''}
      </div>
      <div class="dish-body">
        <div class="dish-info">
          <h3 class="dish-name">${escapeHtml(dish.name)}</h3>
          ${dish.description ? `<p class="dish-desc">${escapeHtml(dish.description)}</p>` : ''}
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

// saca las fotos del platillo, si es uno viejo que solo tenía imageUrl igual funciona
function getDishPhotos(dish) {
  if (Array.isArray(dish.imageUrls) && dish.imageUrls.length > 0) return dish.imageUrls;
  if (dish.imageUrl) return [dish.imageUrl];
  return [];
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// modal de personalizar platillo

const dishModalOverlay = document.getElementById('dish-modal-overlay');
const dishCarouselTrack = document.getElementById('dish-carousel-track');
const dishCarouselDots = document.getElementById('dish-carousel-dots');
const dishCarouselPrev = document.getElementById('dish-carousel-prev');
const dishCarouselNext = document.getElementById('dish-carousel-next');
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
let modalSelectedExtras = new Set(); // qué extras marcó
let modalCarouselIndex = 0;

function openDishModal(dish) {
  modalDish = dish;
  modalQty = 1;
  modalSelectedExtras = new Set();

  buildDishCarousel(getDishPhotos(dish), dish.name);
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
  lockBodyScroll();
}

// armar el carrusel de fotos del platillo
function buildDishCarousel(photos, dishName) {
  modalCarouselIndex = 0;
  dishCarouselTrack.innerHTML = '';
  dishCarouselDots.innerHTML = '';

  const list = photos.length > 0 ? photos : [''];

  list.forEach((url, i) => {
    const slide = document.createElement('div');
    slide.className = 'dish-carousel-slide';
    slide.innerHTML = `<img src="${url || FALLBACK_DISH_IMAGE}" alt="${escapeHtml(dishName)} — foto ${i + 1}" onerror="this.onerror=null;this.src='${FALLBACK_DISH_IMAGE}';">`;
    dishCarouselTrack.appendChild(slide);
  });

  const showNav = list.length > 1;
  dishCarouselPrev.hidden = !showNav;
  dishCarouselNext.hidden = !showNav;
  dishCarouselDots.hidden = !showNav;

  if (showNav) {
    list.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'dish-carousel-dot';
      dot.setAttribute('aria-label', `Ver foto ${i + 1}`);
      dot.addEventListener('click', () => goToCarouselSlide(i));
      dishCarouselDots.appendChild(dot);
    });
  }

  updateCarouselDots();
}

function goToCarouselSlide(index) {
  const slideWidth = dishCarouselTrack.clientWidth;
  dishCarouselTrack.scrollTo({ left: slideWidth * index, behavior: 'smooth' });
}

function updateCarouselDots() {
  const dots = dishCarouselDots.querySelectorAll('.dish-carousel-dot');
  dots.forEach((dot, i) => dot.classList.toggle('is-active', i === modalCarouselIndex));
}

dishCarouselTrack.addEventListener('scroll', () => {
  const slideWidth = dishCarouselTrack.clientWidth;
  if (!slideWidth) return;
  modalCarouselIndex = Math.round(dishCarouselTrack.scrollLeft / slideWidth);
  updateCarouselDots();
});

dishCarouselPrev.addEventListener('click', () => {
  const total = dishCarouselTrack.querySelectorAll('.dish-carousel-slide').length;
  goToCarouselSlide(Math.max(0, modalCarouselIndex - 1));
});

dishCarouselNext.addEventListener('click', () => {
  const total = dishCarouselTrack.querySelectorAll('.dish-carousel-slide').length;
  goToCarouselSlide(Math.min(total - 1, modalCarouselIndex + 1));
});

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

const MAX_QTY_PER_LINE = 20;

document.getElementById('dish-modal-qty-minus').addEventListener('click', () => {
  if (modalQty > 1) {
    modalQty -= 1;
    updateModalQtyDisplay();
    updateModalTotal();
  }
});
document.getElementById('dish-modal-qty-plus').addEventListener('click', () => {
  if (modalQty >= MAX_QTY_PER_LINE) {
    if (window.showToast) {
      showToast({ title: 'Cantidad máxima', message: `Hasta ${MAX_QTY_PER_LINE} por platillo.`, type: 'info' });
    }
    return;
  }
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
  if (dishModalOverlay.hidden) return;
  dishModalOverlay.hidden = true;
  modalDish = null;
  unlockBodyScroll();
}

document.getElementById('dish-modal-close').addEventListener('click', closeDishModal);
dishModalOverlay.addEventListener('click', (e) => {
  if (e.target === dishModalOverlay) closeDishModal();
});

// carrito

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

  if (delta > 0 && line.qty >= MAX_QTY_PER_LINE) {
    if (window.showToast) {
      showToast({ title: 'Cantidad máxima', message: `Hasta ${MAX_QTY_PER_LINE} por platillo.`, type: 'info' });
    }
    return;
  }

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

// abrir y cerrar el carrito
const cartOverlay = document.getElementById('cart-overlay');

document.getElementById('cart-toggle').addEventListener('click', () => {
  renderCartItems();
  cartOverlay.hidden = false;
  lockBodyScroll();
});
document.getElementById('cart-close').addEventListener('click', () => {
  if (cartOverlay.hidden) return;
  cartOverlay.hidden = true;
  unlockBodyScroll();
});
cartOverlay.addEventListener('click', (e) => {
  if (e.target === cartOverlay && !cartOverlay.hidden) {
    cartOverlay.hidden = true;
    unlockBodyScroll();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !cartOverlay.hidden) {
    cartOverlay.hidden = true;
    unlockBodyScroll();
    closeDishModal();
  }
});

// enviar el pedido, se guarda en firestore y el cajero lo ve en vivo, ya no pasa por whatsapp
const cartSubmit = document.getElementById('cart-submit');
const cartNote = document.getElementById('cart-note');
const cartPayment = document.getElementById('cart-payment');
const cartPaymentHint = document.getElementById('cart-payment-hint');

// el campo de pago es opcional, pero si lo llenan tiene que ser número
// y no puede ser menor al total (no tiene sentido pagar con menos billete del que debe)
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

// código de 4 letras/números para que el cliente pueda rastrear su pedido
// (sin 0/O/1/I porque se confunden) no es 100% único pero con tan poco volumen
// de pedidos no debería chocar nunca en la práctica
const ORDER_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateOrderCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += ORDER_CODE_CHARS[Math.floor(Math.random() * ORDER_CODE_CHARS.length)];
  }
  return code;
}

async function saveOrderToFirestore(paymentAmount, cardInfo) {
  const items = cart.map((line) => ({
    name: line.name,
    qty: line.qty,
    price: lineUnitPrice(line),
    extras: line.extras || [],
    removeNote: line.removeNote || '',
  }));

  try {
    const code = generateOrderCode();
    const docRef = await db.collection('orders').add({
      items,
      total: getCartTotal(),
      paymentNote: paymentAmount !== null ? `Q${paymentAmount}` : '',
      paymentMethod: selectedPaymentMethod,
      cardInfo: cardInfo || null,
      note: cartNote.value.trim(),
      customerFirstname: cartCustomerFirstname.value.trim(),
      customerLastname: cartCustomerLastname.value.trim(),
      customerPhone: cartCustomerPhone.value.trim(),
      customerPhone2: cartCustomerPhone2.value.trim(),
      customerAddress: cartCustomerAddress.value.trim(),
      customerKey: normalizeCustomerKey(cartCustomerPhone.value),
      orderCode: code,
      status: 'pendiente',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return { orderId: docRef.id, orderCode: code };
  } catch (err) {
    console.error('No se pudo guardar el pedido:', err);
    return null;
  }
}

// datos del cliente
// usamos el celular como llave para identificarlo (sin login ni nada)
// el resto se guarda en localStorage para que no tenga que escribirlo otra vez
const CUSTOMER_STORAGE_KEY = 'customerProfile';

const cartCustomerFirstname = document.getElementById('cart-customer-firstname');
const cartCustomerLastname = document.getElementById('cart-customer-lastname');
const cartCustomerPhone = document.getElementById('cart-customer-phone');
const cartCustomerPhone2 = document.getElementById('cart-customer-phone2');
const cartCustomerAddress = document.getElementById('cart-customer-address');

// nombre/apellido solo deja letras (con acentos, ñ, apóstrofe y guión por si el nombre es compuesto)
function restrictToLetters(input) {
  input.addEventListener('input', () => {
    const cleaned = input.value.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñÜü' -]/g, '');
    if (cleaned !== input.value) input.value = cleaned;
  });
}
restrictToLetters(cartCustomerFirstname);
restrictToLetters(cartCustomerLastname);

// celular solo deja números, espacios y guiones
function restrictToPhoneChars(input) {
  input.addEventListener('input', () => {
    const cleaned = input.value.replace(/[^0-9 -]/g, '');
    if (cleaned !== input.value) input.value = cleaned;
  });
}
restrictToPhoneChars(cartCustomerPhone);
restrictToPhoneChars(cartCustomerPhone2);

function normalizeCustomerKey(rawPhone) {
  return rawPhone.replace(/\D/g, '');
}

function getSavedCustomerProfile() {
  try {
    const raw = localStorage.getItem(CUSTOMER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function saveCustomerProfile(profile) {
  try {
    localStorage.setItem(CUSTOMER_STORAGE_KEY, JSON.stringify(profile));
  } catch (err) { /* noop */ }
}

// si ya hay datos guardados los rellena solo
(function restoreCustomerProfile() {
  const saved = getSavedCustomerProfile();
  if (!saved) return;
  cartCustomerFirstname.value = saved.firstname || '';
  cartCustomerLastname.value = saved.lastname || '';
  cartCustomerPhone.value = saved.phone || '';
  cartCustomerPhone2.value = saved.phone2 || '';
  cartCustomerAddress.value = saved.address || '';
})();

// botones de efectivo / tarjeta
let selectedPaymentMethod = 'efectivo';
const paymentCashFields = document.getElementById('payment-cash-fields');
const paymentCardFields = document.getElementById('payment-card-fields');

document.querySelectorAll('.payment-method-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.payment-method-btn').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    selectedPaymentMethod = btn.dataset.method;

    paymentCashFields.hidden = selectedPaymentMethod !== 'efectivo';
    paymentCardFields.hidden = selectedPaymentMethod !== 'tarjeta';
  });
});

// campos de tarjeta (esto es solo para el demo, no procesa pago real)
// IMPORTANTE: esto guarda los datos como texto en firestore, está bien para
// mostrar el prototipo pero NUNCA se debe usar así con dinero real
// para un pago real hay que usar algo como Stripe Elements que mande los
// datos directo a la pasarela sin que pasen por tu código - ver el README

const cardNumberInput = document.getElementById('card-number');
const cardHolderInput = document.getElementById('card-holder');
const cardExpiryInput = document.getElementById('card-expiry');
const cardCvvInput = document.getElementById('card-cvv');
const cardFieldsHint = document.getElementById('card-fields-hint');
const cardBrandName = document.getElementById('card-brand-name');
const cardBrandIcon = document.getElementById('card-brand-icon');

const CARD_BRANDS = [
  { name: 'Visa', pattern: /^4/, cvvLength: 3 },
  { name: 'Mastercard', pattern: /^5[1-5]/, cvvLength: 3 },
  { name: 'Mastercard', pattern: /^2[2-7]/, cvvLength: 3 },
  { name: 'American Express', pattern: /^3[47]/, cvvLength: 4 },
];

function detectCardBrand(digits) {
  return CARD_BRANDS.find((b) => b.pattern.test(digits)) || null;
}

// agrupa el número de 4 en 4 mientras escribe
cardNumberInput.addEventListener('input', () => {
  const digits = cardNumberInput.value.replace(/\D/g, '').slice(0, 16);
  cardNumberInput.value = digits.replace(/(.{4})/g, '$1 ').trim();

  const brand = detectCardBrand(digits);
  cardBrandName.textContent = brand ? brand.name : 'Tarjeta';
  cardBrandIcon.className = `card-brand-icon ${brand ? 'has-brand' : ''}`;
  cardCvvInput.maxLength = brand && brand.cvvLength === 4 ? 4 : 3;
});

// nombre del titular solo letras
cardHolderInput.addEventListener('input', () => {
  cardHolderInput.value = cardHolderInput.value.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, '');
});

// fecha de vencimiento se autoformatea a MM/AA
cardExpiryInput.addEventListener('input', () => {
  let digits = cardExpiryInput.value.replace(/\D/g, '').slice(0, 4);
  if (digits.length >= 3) {
    digits = `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }
  cardExpiryInput.value = digits;
});

// cvv solo números
cardCvvInput.addEventListener('input', () => {
  cardCvvInput.value = cardCvvInput.value.replace(/\D/g, '');
});

function showCardHint(message) {
  cardFieldsHint.textContent = message;
  cardFieldsHint.hidden = false;
}

// solo valida la tarjeta si el cliente eligió pagar con tarjeta
// devuelve { valid, data } - data viene lleno solo si valid es true
function validateCardFields() {
  if (selectedPaymentMethod !== 'tarjeta') {
    return { valid: true, data: null };
  }

  cardFieldsHint.hidden = true;
  const digits = cardNumberInput.value.replace(/\D/g, '');
  const brand = detectCardBrand(digits);

  if (digits.length < 13 || digits.length > 16) {
    showCardHint('El número de tarjeta no parece válido.');
    return { valid: false, data: null };
  }
  if (!brand) {
    showCardHint('No reconocemos esa tarjeta (debe ser Visa, Mastercard o Amex).');
    return { valid: false, data: null };
  }
  if (!cardHolderInput.value.trim()) {
    showCardHint('Escribe el nombre del titular.');
    return { valid: false, data: null };
  }

  const expiryMatch = /^(\d{2})\/(\d{2})$/.exec(cardExpiryInput.value);
  if (!expiryMatch) {
    showCardHint('La fecha de vencimiento debe tener el formato MM/AA.');
    return { valid: false, data: null };
  }
  const month = Number(expiryMatch[1]);
  const year = Number(expiryMatch[2]);
  if (month < 1 || month > 12) {
    showCardHint('El mes de vencimiento no es válido.');
    return { valid: false, data: null };
  }
  const now = new Date();
  const currentYear = now.getFullYear() % 100;
  const currentMonth = now.getMonth() + 1;
  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    showCardHint('Esa tarjeta ya está vencida.');
    return { valid: false, data: null };
  }

  const expectedCvvLength = brand.cvvLength;
  if (cardCvvInput.value.length !== expectedCvvLength) {
    showCardHint(`El CVV debe tener ${expectedCvvLength} dígitos.`);
    return { valid: false, data: null };
  }

  return {
    valid: true,
    data: {
      brand: brand.name,
      lastFour: digits.slice(-4),
      holder: cardHolderInput.value.trim(),
      expiry: cardExpiryInput.value,
    },
  };
}

// cooldown para que no manden pedidos en cadena, 3 minutos entre cada uno
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

// si ya cancelaron o entregaron el pedido ya no tiene sentido seguir esperando
function clearCooldown() {
  try {
    localStorage.removeItem(LAST_ORDER_TIME_KEY);
  } catch (err) { /* noop */ }
}

let isSubmittingOrder = false;

cartSubmit.addEventListener('click', async (e) => {
  e.preventDefault();

  // Guarda contra doble-click / doble-tap: si ya hay un envío en curso,
  // ignoramos cualquier clic adicional de inmediato — no depende de que
  // el navegador termine de pintar el estilo "is-sending" a tiempo.
  if (isSubmittingOrder) return;
  if (getCartCount() === 0) return;

  if (restaurantInfo && restaurantInfo.isOpen === false) {
    if (window.showToast) {
      showToast({
        title: 'Estamos cerrados',
        message: 'No podemos recibir pedidos en este momento.',
        type: 'error',
      });
    }
    return;
  }

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

  const requiredFields = [
    { el: cartCustomerFirstname, label: 'tu nombre' },
    { el: cartCustomerLastname, label: 'tu apellido' },
    { el: cartCustomerPhone, label: 'tu celular' },
    { el: cartCustomerAddress, label: 'tu dirección' },
  ];
  const missing = requiredFields.find((f) => !f.el.value.trim());
  if (missing) {
    if (window.showToast) {
      showToast({
        title: 'Falta un dato',
        message: `Necesitamos ${missing.label} para procesar tu pedido.`,
        type: 'error',
      });
    }
    missing.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const paymentCheck = validatePayment();
  if (!paymentCheck.valid) {
    cartPayment.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const cardCheck = validateCardFields();
  if (!cardCheck.valid) {
    cardNumberInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  isSubmittingOrder = true;
  cartSubmit.disabled = true;
  cartSubmit.classList.add('is-sending');

  let result;
  try {
    result = await saveOrderToFirestore(paymentCheck.amount, cardCheck.data);
  } finally {
    isSubmittingOrder = false;
    cartSubmit.disabled = false;
    cartSubmit.classList.remove('is-sending');
  }

  if (!result) {
    if (window.showToast) {
      showToast({
        title: 'No se pudo enviar el pedido',
        message: 'Revisa tu conexión e intenta de nuevo.',
        type: 'error',
      });
    }
    return;
  }

  const { orderId, orderCode } = result;

  markOrderSentNow();
  saveCustomerProfile({
    firstname: cartCustomerFirstname.value.trim(),
    lastname: cartCustomerLastname.value.trim(),
    phone: cartCustomerPhone.value.trim(),
    phone2: cartCustomerPhone2.value.trim(),
    address: cartCustomerAddress.value.trim(),
  });
  rememberMyOrder(orderId, getCartTotal(), orderCode);
  if (window.showToast) {
    showToast({
      title: 'Pedido enviado',
      message: 'Apunta tu número de pedido. Puedes cancelarlo desde "Mi pedido" los próximos 10 minutos.',
      type: 'success',
      duration: 9000,
      code: orderCode,
    });
  }
  cart = [];
  cartNote.value = '';
  cartPayment.value = '';
  cartPaymentHint.hidden = true;
  cardNumberInput.value = '';
  cardHolderInput.value = '';
  cardExpiryInput.value = '';
  cardCvvInput.value = '';
  cardFieldsHint.hidden = true;
  updateCartUI();
  renderMenu();
  cartOverlay.hidden = true;
  unlockBodyScroll();
});

// "mi pedido" - el botón flotante que sigue el pedido en vivo
// se guarda el id en localStorage (solo este dispositivo lo puede cancelar)
// pero el estado se escucha en vivo desde firestore por si el cajero lo cambia
// 10 minutos para poder cancelar desde que se manda

const CANCEL_WINDOW_MS = 10 * 60 * 1000;
const MY_ORDER_KEY = 'lastOrder';

const ORDER_STATUS_LABEL = {
  pendiente: 'Pendiente',
  proceso: 'Cocinando',
  camino: 'En camino',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

const TIMELINE_ORDER = ['pendiente', 'proceso', 'camino', 'entregado'];

const orderStatusOverlay = document.getElementById('order-status-overlay');
const orderTimeline = document.getElementById('order-timeline');
const orderCancelledState = document.getElementById('order-cancelled-state');
const orderStatusCancelSection = document.getElementById('order-status-cancel-section');
const orderStatusTimer = document.getElementById('order-status-timer');

let myOrderUnsubscribe = null;
let myOrderLastKnownStatus = null;
let cancelledByMe = false;

function rememberMyOrder(orderId, total, orderCode) {
  const data = { orderId, total, orderCode, sentAt: Date.now() };
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
  if (existing) {
    showMyOrderButton();
    watchMyOrderStatus(existing.orderId);
  }
}

// escucha el pedido en vivo para enterarse si el cajero cambia el estado
function watchMyOrderStatus(orderId) {
  if (myOrderUnsubscribe) myOrderUnsubscribe();
  myOrderLastKnownStatus = null;

  myOrderUnsubscribe = db.collection('orders').doc(orderId).onSnapshot((doc) => {
    if (!doc.exists) return;
    const status = doc.data().status;

    // en la primera lectura no avisamos (ya vio el toast de "pedido enviado")
    // excepto si ya estaba entregado, porque puede que cerró la página y volvió después
    if (myOrderLastKnownStatus === null) {
      myOrderLastKnownStatus = status;
      if (status === 'entregado') {
        announceStatusChange(status, false);
        startDeliveredCountdown();
      }
      return;
    }

    if (status !== myOrderLastKnownStatus) {
      myOrderLastKnownStatus = status;
      announceStatusChange(status, cancelledByMe);
      cancelledByMe = false;

      // Si el panel de seguimiento está abierto, actualizar la línea de
      // tiempo en vivo sin que el cliente tenga que cerrar y volver a abrir.
      if (!orderStatusOverlay.hidden) {
        renderOrderTimeline(status);
      }

      if (status === 'entregado') {
        if (cancelWindowInterval) clearInterval(cancelWindowInterval);
        startDeliveredCountdown();
      }

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
  // Si el pedido terminó (entregado o cancelado), no tiene sentido seguir
  // bloqueando al cliente de hacer otro pedido nuevo.
  if (status === 'entregado' || status === 'cancelado') {
    clearCooldown();
  }

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

function showMyOrderButton() {
  const btn = document.getElementById('my-order-btn');
  btn.hidden = false;
  document.getElementById('my-order-btn-label').textContent = 'Mi pedido';
}

// cronómetro de los 10 min para cancelar, vive dentro del panel
// cuando llega a 0 solo se oculta el botón de cancelar, el resto sigue normal
function tickCancelWindow(data) {
  const timeLeft = CANCEL_WINDOW_MS - (Date.now() - data.sentAt);

  if (timeLeft <= 0) {
    orderStatusCancelSection.hidden = true;
    if (cancelWindowInterval) clearInterval(cancelWindowInterval);
    return;
  }

  const mins = Math.floor(timeLeft / 60000);
  const secs = Math.floor((timeLeft % 60000) / 1000);
  if (orderStatusTimer) {
    orderStatusTimer.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}

let cancelWindowInterval = null;
function startCancelWindowCountdown(data) {
  if (cancelWindowInterval) clearInterval(cancelWindowInterval);
  tickCancelWindow(data);
  cancelWindowInterval = setInterval(() => tickCancelWindow(data), 1000);
}

// este es otro cronómetro distinto, el de después de entregado
// cuando llega a 0 se esconde el botón "mi pedido" y se cierra el panel si estaba abierto
const DELIVERED_COUNTDOWN_MS = 90 * 1000;
let deliveredCountdownEndAt = null;

function startDeliveredCountdown() {
  deliveredCountdownEndAt = Date.now() + DELIVERED_COUNTDOWN_MS;

  const btn = document.getElementById('my-order-btn');
  btn.hidden = false;
  document.getElementById('my-order-btn-label').textContent = 'Entregado ·';
  document.getElementById('my-order-timer').hidden = false;

  if (myOrderTickInterval) clearInterval(myOrderTickInterval);
  tickDeliveredCountdown();
  myOrderTickInterval = setInterval(tickDeliveredCountdown, 1000);
}

function tickDeliveredCountdown() {
  const btn = document.getElementById('my-order-btn');
  const timeLeft = deliveredCountdownEndAt - Date.now();

  if (timeLeft <= 0) {
    btn.hidden = true;
    clearInterval(myOrderTickInterval);
    clearMyOrder();
    if (myOrderUnsubscribe) myOrderUnsubscribe();
    if (!orderStatusOverlay.hidden) {
      orderStatusOverlay.hidden = true;
      unlockBodyScroll();
    }
    return;
  }

  const mins = Math.floor(timeLeft / 60000);
  const secs = Math.floor((timeLeft % 60000) / 1000);
  const formatted = `${mins}:${secs.toString().padStart(2, '0')}`;
  document.getElementById('my-order-timer').textContent = formatted;
  if (orderStatusTimer) orderStatusTimer.textContent = formatted;
}

document.getElementById('my-order-btn').addEventListener('click', () => {
  const data = getMyOrder();
  if (!data) return;
  openOrderStatusPanel(data);
});

// panel con la línea de tiempo
function openOrderStatusPanel(data) {
  orderStatusOverlay.hidden = false;
  lockBodyScroll();
  document.getElementById('order-status-code').textContent = data.orderCode || '----';
  const status = myOrderLastKnownStatus || 'pendiente';
  renderOrderTimeline(status);
  if (status === 'pendiente' || status === 'proceso') {
    startCancelWindowCountdown(data);
  }
}

function renderOrderTimeline(status, readOnly) {
  if (status === 'cancelado') {
    orderTimeline.hidden = true;
    orderCancelledState.hidden = false;
    orderStatusCancelSection.hidden = true;
    return;
  }

  orderTimeline.hidden = false;
  orderCancelledState.hidden = true;

  const currentIndex = TIMELINE_ORDER.indexOf(status);
  orderTimeline.querySelectorAll('.order-timeline-step').forEach((step) => {
    const stepIndex = TIMELINE_ORDER.indexOf(step.dataset.step);
    step.classList.remove('is-done', 'is-current');
    if (stepIndex < currentIndex) step.classList.add('is-done');
    if (stepIndex === currentIndex) step.classList.add('is-current');
  });

  // Una vez entregado, ya no aplica cancelar. Tampoco aplica en modo
  // de solo lectura (rastreo por código), donde nunca se puede cancelar.
  orderStatusCancelSection.hidden = readOnly || status === 'entregado';
}

function closeOrderStatusPanel() {
  if (orderStatusOverlay.hidden) return;
  orderStatusOverlay.hidden = true;
  unlockBodyScroll();
}

document.getElementById('order-status-close').addEventListener('click', closeOrderStatusPanel);
orderStatusOverlay.addEventListener('click', (e) => {
  if (e.target === orderStatusOverlay) closeOrderStatusPanel();
});

document.getElementById('order-status-code-copy').addEventListener('click', async () => {
  const code = document.getElementById('order-status-code').textContent.trim();
  if (!code || code === '----') return;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(code);
    } else {
      // Respaldo para contextos donde la API moderna no está disponible
      // (ej. sin HTTPS) — usa el método clásico de seleccionar y copiar.
      const temp = document.createElement('textarea');
      temp.value = code;
      temp.style.position = 'fixed';
      temp.style.opacity = '0';
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
    }
    if (window.showToast) {
      showToast({ title: 'Código copiado', message: code, type: 'success', duration: 3000 });
    }
  } catch (err) {
    console.error('No se pudo copiar el código:', err);
    if (window.showToast) {
      showToast({ title: 'No se pudo copiar', message: 'Apunta el código manualmente.', type: 'error' });
    }
  }
});

document.getElementById('order-status-cancel-btn').addEventListener('click', () => {
  const data = getMyOrder();
  if (!data) return;
  openCancelConfirm(data);
});

// confirmar antes de cancelar
const cancelConfirmOverlay = document.getElementById('cancel-confirm-overlay');

function openCancelConfirm(data) {
  cancelConfirmOverlay.hidden = false;
  lockBodyScroll();
}

document.getElementById('cancel-confirm-no').addEventListener('click', () => {
  cancelConfirmOverlay.hidden = true;
  unlockBodyScroll();
});

document.getElementById('cancel-confirm-yes').addEventListener('click', async () => {
  const data = getMyOrder();
  cancelConfirmOverlay.hidden = true;
  unlockBodyScroll();
  if (!data) return;

  const timeLeft = CANCEL_WINDOW_MS - (Date.now() - data.sentAt);
  if (timeLeft <= 0) {
    if (window.showToast) {
      showToast({ title: 'Ya no se puede cancelar', message: 'Pasaron más de 10 minutos.', type: 'error' });
    }
    orderStatusCancelSection.hidden = true;
    if (cancelWindowInterval) clearInterval(cancelWindowInterval);
    return;
  }

  try {
    // Marcamos que esta cancelación la inició el cliente, para que el
    // listener en tiempo real (watchMyOrderStatus) muestre el mensaje
    // correcto y no el de "el negocio canceló tu pedido".
    cancelledByMe = true;
    await db.collection('orders').doc(data.orderId).update({
      status: 'cancelado',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('No se pudo cancelar el pedido:', err);
    cancelledByMe = false;
    if (window.showToast) {
      showToast({ title: 'No se pudo cancelar', message: 'Intenta de nuevo en un momento.', type: 'error' });
    }
  }
});

// "mis pedidos" - historial de pedidos del cliente, identificado por su teléfono

const myOrdersOverlay = document.getElementById('my-orders-overlay');
const myOrdersList = document.getElementById('my-orders-list');
const myOrdersEmpty = document.getElementById('my-orders-empty');
let myOrdersUnsubscribe = null;

// el botón de "mis pedidos" se quitó del header pero dejamos toda la lógica
// por si la quieren de vuelta después, este if evita que truene si el botón no existe
const myOrdersToggleBtn = document.getElementById('my-orders-toggle');
if (myOrdersToggleBtn) {
  myOrdersToggleBtn.addEventListener('click', () => {
    const saved = getSavedCustomerProfile();
    if (!saved || !saved.phone) {
      if (window.showToast) {
        showToast({
          title: 'Todavía no tienes pedidos',
          message: 'Haz tu primer pedido y vas a poder verlo aquí.',
          type: 'info',
        });
      }
      return;
    }
    openMyOrders(saved.phone);
  });
}

document.getElementById('my-orders-close').addEventListener('click', () => {
  if (myOrdersOverlay.hidden) return;
  myOrdersOverlay.hidden = true;
  unlockBodyScroll();
});
myOrdersOverlay.addEventListener('click', (e) => {
  if (e.target === myOrdersOverlay && !myOrdersOverlay.hidden) {
    myOrdersOverlay.hidden = true;
    unlockBodyScroll();
  }
});

function openMyOrders(phone) {
  myOrdersOverlay.hidden = false;
  lockBodyScroll();
  const key = normalizeCustomerKey(phone);

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

// arranca todo
updateCartUI();
loadDishes();
loadCategoryNames();
loadRestaurantInfo();
initMyOrderTracker();
