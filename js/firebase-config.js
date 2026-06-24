// ============================================================
// CONFIGURACIÓN DE FIREBASE — Prototipo de menú digital
// ============================================================
// PROTOTIPO: este archivo trae datos de ejemplo. Antes de usarlo
// con un negocio real, reemplaza TODO lo de abajo con las llaves
// de un proyecto de Firebase propio y el WhatsApp real del negocio.
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyAZ4R3LQ-CtZNPJt0zIOZzlWpBLv2J84R4",
  authDomain: "menu-prototipo.firebaseapp.com",
  projectId: "menu-prototipo",
  storageBucket: "menu-prototipo.firebasestorage.app",
  messagingSenderId: "33813643589",
  appId: "1:33813643589:web:3752e824c58aa7602b3e2c"
};

// Número de WhatsApp del negocio (con código de país, sin "+", sin espacios)
const WHATSAPP_NUMBER = "50200000000";

// ============================================================
// CONFIGURACIÓN DE CLOUDINARY — para guardar las fotos
// ============================================================
const CLOUDINARY_CLOUD_NAME = "dqxmqkbzm";
const CLOUDINARY_UPLOAD_PRESET = "menu_prototipo_uploads";

// Inicializa Firebase (no tocar)
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
