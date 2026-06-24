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
con suficiente densidad para sentirse un producto completo. Tanto el sitio del
cliente como el panel del cajero usan fondo claro (blanco y beige), sin negro
ni superficies oscuras — el panel usa esquinas casi rectas (4px) y geometría
administrativa seria, mientras el sitio del cliente mantiene un estilo más
cálido y redondeado.

### Modo oscuro (solo en el panel del cajero)

El panel del cajero (`/admin/`) tiene un switch de sol/luna en el header que
cambia todo el panel (pestaña Pedidos + pestaña Menú) a una versión oscura,
pensado para sesiones largas frente a la pantalla. La preferencia se guarda en
`localStorage` (clave `cashierTheme`), así que se recuerda entre visitas. El
sitio del cliente no tiene modo oscuro — solo aplica al panel administrativo.

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
```

## Hero

El hero principal usa un fondo con degradado en los colores de marca (sin foto por
defecto), texto y botones sólidos encima. Sin animaciones 3D ni librerías pesadas —
HTML/CSS plano, rápido de cargar. Para usar una foto real ahí, hay que agregar una
imagen propia y volver a poner la etiqueta `<img class="hero-img">` dentro de
`.hero-media` en `index.html` (se quitó al limpiar las fotos de muestra del
prototipo).

El menú no muestra datos de muestra: si Firestore está vacío o aún no está
conectado, simplemente aparece el estado vacío normal ("no hay platillos en esta
categoría todavía"). Los platillos reales se suben desde `/admin/`.

## Categorías, extras y personalización del pedido

- **Categorías**: viven en su propia colección (`categories`), con un contador de uso
  (`useCount`) que sube cada vez que se publica un platillo en esa categoría — así
  las más usadas aparecen primero al elegir categoría para un platillo nuevo. Al
  eliminar una categoría que tiene platillos, el cajero elige explícitamente qué
  hacer: **mover** esos platillos a "Sin categoría", o **borrar** la categoría junto
  con todos sus platillos (irreversible). "Sin categoría" es un cajón interno —
  se ve y se administra desde el panel del cajero, pero nunca aparece como pestaña
  ni etiqueta visible en el sitio del cliente.
- **Arrastrar y soltar**: en "Menú actual" del panel, cualquier platillo se puede
  arrastrar hacia otra sección de categoría para reasignarlo al instante (sin abrir
  ningún formulario). Funciona con la API nativa de drag-and-drop del navegador.
- **Extras**: cada platillo puede tener una lista de extras opcionales con su propio
  precio (ej. "Bebida +Q12"). El cliente los marca con checkbox al personalizar el
  platillo, y el precio se suma al total de esa línea.
- **Quitar algo**: el cliente puede escribir una nota libre por platillo (ej. "sin
  cebolla") que viaja con esa línea específica del pedido, no como nota general.
- **Pago con**: campo numérico opcional en el carrito para que el cliente indique
  con qué billete pagará (ej. Q100). Se valida que sea un número y que sea mayor o
  igual al total — si pone menos de lo que cuesta el pedido, no lo deja enviar.
  El panel del cajero calcula y muestra el vuelto automáticamente.
- **Fotos múltiples**: cada platillo admite hasta 10 fotos (`imageUrls`, array).
  El cliente las ve como carrusel deslizable (con flechas y puntos) dentro del
  modal de personalización; en la tarjeta del menú solo se muestra la primera
  foto, con una etiqueta de cuántas fotos tiene en total.
- **Datos del cliente**: el carrito pide nombre, apellido, celular (obligatorios),
  número secundario y nota de pago (opcionales), dirección de entrega (obligatoria)
  y método de pago (efectivo/tarjeta). El celular normalizado (solo dígitos) es la
  clave que identifica al cliente para "Mis pedidos" — se guarda en su navegador y
  se autocompleta la próxima vez.
- **Pago con tarjeta (demo, no apto para producción)**: si el cliente elige
  "Tarjeta", aparecen los campos de número (con detección automática de
  Visa/Mastercard/Amex y máscara de entrada), nombre del titular, vencimiento
  (MM/AA, valida que no esté vencida) y CVV (3 o 4 dígitos según la marca). Esto
  **solo valida el formato** — no procesa ningún pago real. En Firestore se
  guarda únicamente la marca, los últimos 4 dígitos, el titular y el vencimiento;
  nunca el número completo ni el CVV. **Importante**: un sistema de pago real
  nunca debe pasar estos datos por tu propio código ni guardarlos en tu base de
  datos — eso viola las normas de seguridad de tarjetas (PCI-DSS). Lo correcto es
  usar un campo embebido de una pasarela de pago real (ej. Stripe Elements, o un
  banco local), que manda los datos directo del navegador del cliente a la
  pasarela y te devuelve solo un token — los datos de la tarjeta nunca tocan tu
  servidor ni tu base de datos. Conectar eso es trabajo aparte (cuenta de
  comercio, verificación del negocio, comisión por transacción).

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
9. Crear el índice compuesto de Firestore para "Mis pedidos" (ver abajo)

## Índice de Firestore para "Mis pedidos"

La función "Mis pedidos" hace una consulta que filtra por `customerKey` y ordena
por `createdAt` al mismo tiempo — Firestore exige un **índice compuesto** para
ese tipo de consulta. La forma más fácil de crearlo:

1. Abre el sitio y prueba la función "Mis pedidos" (ícono de lista en el header)
2. Si el índice no existe, va a salir un error en la consola del navegador (F12)
   con un link tipo `https://console.firebase.google.com/.../indexes?create_composite=...`
3. Abre ese link — Firebase ya viene con los campos correctos prellenados
4. Dale click en **"Crear índice"** / **"Create index"**
5. Espera 1-2 minutos a que termine de construirse (estado "Habilitando" → "Habilitado")

Después de eso, "Mis pedidos" funciona sin problema.

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

## Seguimiento y cancelación desde el cliente

Después de enviar un pedido, aparece un botón flotante **"Mi pedido"** con una
cuenta regresiva de 10 minutos. Al tocarlo, se abre un panel con una **línea de
tiempo visual** (Pendiente → En proceso → Entregado) que muestra en qué etapa
está el pedido en este momento, o un estado especial si fue cancelado. Dentro de
ese mismo panel está el botón para cancelar, visible mientras el contador no
llegue a cero — pasado ese tiempo, la opción de cancelar desaparece. Esto se
guarda en el `localStorage` del navegador del cliente (no requiere cuenta ni
código), así que solo funciona en el mismo dispositivo desde el que se hizo el
pedido.

El cambio de estado se sigue en tiempo real (con un listener a ese pedido
específico): si el cajero lo cancela, avanza a "en proceso" o lo marca como
entregado, tanto la línea de tiempo (si el panel está abierto) como una
notificación toast se actualizan al instante — sin importar quién hizo el
cambio, y sin que el cliente tenga que cerrar y volver a abrir nada.

## "Mis pedidos"

Al hacer su primer pedido, el cliente escribe su nombre y teléfono — se guarda
en su navegador y se autocompleta la próxima vez. Con el ícono de lista en el
header puede abrir **"Mis pedidos"**, que lista sus últimos 20 pedidos con el
estado de cada uno en tiempo real.

**Nota de privacidad honesta**: como no hay cuentas reales ni contraseñas, esto
identifica al cliente por el texto exacto que escribió (nombre/teléfono), no por
una identidad verificada. Alguien que conozca el nombre exacto de otra persona
técnicamente podría ver su lista de pedidos. Es la misma limitación de cualquier
sistema "sin registro" — para una identificación más segura haría falta un login
real (con el costo de fricción que eso implica para un menú de pick-up rápido).

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
      allow delete: if request.auth != null;

      // Lectura pública: necesaria para que el cliente pueda seguir su
      // propio pedido en tiempo real (sabe el ID exacto, que es largo y
      // aleatorio — no es adivinable navegando la colección al azar).
      allow read: if true;

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
