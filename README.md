# Prototipo — Menú digital con pedidos en tiempo real

Prototipo de sitio de menú digital, con carrito y pedidos que se guardan directo
en el sistema (el cajero los ve en tiempo real en su panel). WhatsApp queda como
botón de contacto general en el header y footer, separado del flujo de pedir.
Pensado para mostrarse a distintos restaurantes y personalizarse para cada uno
(nombre, colores, número de WhatsApp, catálogo real).

## Notificaciones

Cuando llega un pedido nuevo y el panel está abierto, aparece una notificación
flotante (toast) con sonido y la tarjeta resalta brevemente. Esto es gratis y ya
funciona — el pedido llega directo a Firestore, no depende de WhatsApp en ningún
punto. **No existe (todavía) un envío automático y gratuito de WhatsApp** hacia
el negocio sin que un humano confirme — eso requeriría la API oficial de WhatsApp
Business (con costo y proceso de aprobación de Meta), que queda como mejora futura
si se decide invertir en ella.

## Sistema de diseño

Dirección visual: cocina casera seria, no plantilla genérica ni carta vacía.
Colores cálidos y apetitosos (paprika, mostaza, café tostado, verde albahaca),
con suficiente densidad para sentirse un producto completo. El cliente usa
fondo claro (crema); el panel de pedidos usa una superficie oscura tipo
"cocina de noche" — alto contraste, fácil de leer rápido bajo presión, que
es justo el contexto real donde alguien va a usar esa pantalla mientras
cocina o empaca pedidos.

## Estructura

```
index.html             → página pública del menú (clientes)
admin/index.html        → panel privado del cajero: pedidos en tiempo real + gestión del menú
css/styles.css           → estilos del sitio público y del panel (compartidos)
admin/admin.css           → estilos adicionales solo del panel (incluye el tablero oscuro)
js/menu.js                → lógica del menú + carrito + envío del pedido a Firestore
js/toast.js                → sistema de notificaciones flotantes (compartido)
admin/admin.js              → lógica del panel (login, pedidos, subir, eliminar)
js/firebase-config.js        → AQUÍ van tus llaves de Firebase y Cloudinary
assets/dishes/                → fotos de muestra de platillos (demo)
```

## Hero y fotos de muestra

El hero principal usa una foto grande de fondo con overlay degradado oscuro
hacia la izquierda, texto y botones sólidos encima. Sin animaciones 3D ni
librerías pesadas — HTML/CSS plano, rápido de cargar.

Mientras Firestore esté vacío o sin conectar, `js/menu.js` muestra automáticamente
**6 platillos de muestra** (con fotos en `assets/dishes/`) para que el demo no se vea
vacío al presentarlo. En cuanto el negocio empiece a publicar platillos reales desde
el panel de admin, esos sustituyen a los de muestra automáticamente — no hay que
borrar nada a mano.

Para usar fotos propias del negocio, basta con reemplazar los archivos `assets/dishes/dish-1.jpg`
a `dish-6.jpg` (o subir platillos reales desde `/admin/`, que es el camino normal de uso).

## Categorías, extras y personalización del pedido

- **Categorías**: viven en su propia colección (`categories`), con un contador de uso
  (`useCount`) que sube cada vez que se publica un platillo en esa categoría — así
  las más usadas aparecen primero al elegir categoría para un platillo nuevo. El
  admin puede crear categorías manualmente o eliminarlas; si una categoría eliminada
  todavía tiene platillos, estos se reasignan automáticamente a "Sin categoría" (no
  se borran ni quedan bloqueados).
- **Extras**: cada platillo puede tener una lista de extras opcionales con su propio
  precio (ej. "Bebida +Q12"). El cliente los marca con checkbox al personalizar el
  platillo, y el precio se suma al total de esa línea.
- **Quitar algo**: el cliente puede escribir una nota libre por platillo (ej. "sin
  cebolla") que viaja con esa línea específica del pedido, no como nota general.
- **Pago con**: campo opcional en el carrito para que el cliente indique con qué
  billete pagará (ej. "pago con Q100") — aparece en el ticket y destacado en la
  tarjeta del pedido dentro del panel del cajero.

## Pendiente antes de funcionar

Sigue el mismo proceso que ya hiciste para Lily Nails, pero con un **proyecto de
Firebase nuevo y separado** (no reutilices el de Lily Nails):

1. Crear un proyecto nuevo en Firebase (ej: `casa-del-adobo`)
2. Activar **Authentication** (método correo/contraseña) y crear el usuario del panel
3. Activar **Firestore Database** (modo producción)
4. Pegar las reglas de seguridad de abajo en Firestore Rules
5. Crear cuenta en **Cloudinary** (puede ser la misma que ya tienes, o una nueva) y sacar
   el cloud name + un upload preset en modo "Unsigned"
6. Reemplazar todos los valores en `js/firebase-config.js`
7. Agregar el dominio de GitHub Pages a los "Dominios autorizados" de Firebase Authentication
8. Subir todo a un repositorio NUEVO de GitHub y activar GitHub Pages

## Panel de pedidos en tiempo real

Además del catálogo, el panel de administración (`/admin/`, llamado "Cajero" en la
interfaz) tiene una pestaña **"Pedidos"** con un tablero de 4 columnas:

- **Pendientes** — recién llegados, sin atender
- **En proceso** — el cajero le dio click a "Empezar a preparar"
- **Entregados** — ya se le dio el pedido al cliente
- **Cancelados** — el cliente lo canceló desde su propio dispositivo

Cuando un cliente completa un pedido desde el menú público, este se guarda
directo en Firestore (colección `orders`) y aparece al instante en el tablero
del cajero — no pasa por WhatsApp en ningún punto. Cuando llega un pedido nuevo
o se cancela uno mientras el panel está abierto, aparece una notificación
flotante (toast) con sonido para los pedidos nuevos, y la tarjeta resalta
brevemente.

## Cancelación desde el cliente

Después de enviar un pedido, aparece un botón flotante **"Mi pedido"** con una
cuenta regresiva de 10 minutos. El cliente puede cancelarlo desde ahí mientras
el contador no llegue a cero — pasado ese tiempo, el botón desaparece y ya no se
puede cancelar. Esto se guarda en el `localStorage` del navegador del cliente
(no requiere cuenta ni código), así que solo funciona en el mismo dispositivo
desde el que se hizo el pedido. Al cancelar, el negocio recibe una notificación
en el panel.

## Reglas de seguridad — Firestore

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /dishes/{dishId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /categories/{categoryId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /orders/{orderId} {
      allow create: if true;
      allow read, delete: if request.auth != null;

      // El cajero puede actualizar lo que sea.
      // Un cliente sin sesión SOLO puede cancelar su propio pedido:
      // únicamente puede cambiar el campo "status" a "cancelado",
      // y solo si el pedido todavía está "pendiente". No puede tocar
      // el total, los items, ni marcarlo como entregado/en proceso.
      allow update: if request.auth != null || (
        resource.data.status == 'pendiente' &&
        request.resource.data.status == 'cancelado' &&
        request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status'])
      );
    }
  }
}
```


Cualquiera puede **ver** el menú y las categorías sin iniciar sesión; solo quien tenga
sesión iniciada (el dueño/administrador) puede agregar, editar o eliminar platillos
y categorías.

Para pedidos: cualquier cliente puede **crear** un pedido nuevo (es lo que pasa
cuando le da "Pedir para pick-up"), pero solo el negocio con sesión iniciada puede
**leer, actualizar o eliminar** pedidos — así un cliente no puede ver el listado de
pedidos de otros ni cambiarle el estado a los suyos.

## Nota técnica importante (lección de Lily Nails)

En `css/styles.css` y `admin/admin.css`, cada elemento que se oculta/muestra con el
atributo `hidden` de HTML tiene una regla extra:

```css
.login-screen[hidden] { display: none; }
```

Esto es necesario porque si una clase ya define `display: flex` (o cualquier otro
display) en ese mismo elemento, el atributo `hidden` por sí solo NO logra ocultarlo
— la regla de la clase le gana. Si en el futuro agregas una nueva pantalla que se
oculta/muestra dinámicamente, recuerda aplicar este mismo patrón.

## El link del panel

El panel vive en `/admin/`, sin enlace visible desde el sitio público — protegido
por su propio login real (Firebase Authentication), no solo "escondido".

Ejemplo de link final: `https://tu-usuario.github.io/tu-repo/admin/`
