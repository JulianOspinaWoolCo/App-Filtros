# Shopify Search App — Self-hosted

Tu propio motor de búsqueda y filtros para Shopify, similar a Boost Commerce.

## Arquitectura

```
Shopify Admin API (GraphQL)
        ↓ sync
   PostgreSQL (Render)
        ↓ REST API
   collection-section.liquid (tema)
        ↓ renderiza
   Colección ordenada por metafields ✅
```

---

## Deploy en Render (gratis)

### 1. Subir el código a GitHub

```bash
git init
git add .
git commit -m "initial"
git remote add origin https://github.com/TU-USUARIO/shopify-search-app.git
git push -u origin main
```

### 2. Crear cuenta en Render

Ve a https://render.com y conéctalo con tu GitHub.

### 3. Deploy con render.yaml

- New → Blueprint
- Conecta tu repo
- Render detecta `render.yaml` y crea automáticamente:
  - El servidor Node.js
  - La base de datos PostgreSQL (gratis)

### 4. Variables de entorno en Render

En tu servicio → Environment:

```
SHOP_DOMAIN   = tu-tienda.myshopify.com
ACCESS_TOKEN  = shpat_xxx
WEBHOOK_SECRET = (ver paso 5)
ADMIN_KEY     = cualquier-string-secreto
```

### 5. Crear webhooks en Shopify

Ve a: Admin → Configuración → Notificaciones → Webhooks

Crea estos 2 webhooks:

| Evento | URL |
|--------|-----|
| Producto actualizado | `https://TU-APP.onrender.com/webhooks/products/update` |
| Producto eliminado   | `https://TU-APP.onrender.com/webhooks/products/delete` |

Copia el **Signing secret** → ponlo en `WEBHOOK_SECRET` en Render.

### 6. Sync inicial

El servidor hace el sync automáticamente al arrancar si la DB está vacía.
También puedes forzarlo:

```bash
curl -X POST https://TU-APP.onrender.com/admin/sync \
  -H "x-admin-key: TU-ADMIN-KEY"
```

Con 11,000 productos tarda ~5-10 minutos.

---

## Configurar el tema

### 1. Poner la URL de tu app en Shopify

Ve a Admin → Contenido → Metafields (de la tienda) y agrega:
- Namespace: `custom`
- Key: `search_api_url`
- Valor: `https://TU-APP.onrender.com`

O edita directamente el Liquid y reemplaza la variable por la URL hardcoded.

### 2. Reemplazar el archivo del tema

Reemplaza el archivo de tu sección de colección con `collection-section.liquid`.

Si tu thumbnail (`common__product-thumbnail`) tiene HTML específico,
edita la función `renderProduct()` en el JS para que coincida.

---

## API

### GET /api/products

```
/api/products?collection=gid://shopify/Collection/123&sortBy=color&order=asc&page=1&limit=48
```

Params:
- `collection` — ID de colección (requerido)
- `sortBy` — `color` | `number` | `name` | `price`
- `order` — `asc` | `desc`
- `instock` — `true` para solo productos disponibles
- `page` — número de página
- `limit` — max 250

Respuesta:
```json
{
  "total": 5000,
  "page": 1,
  "pages": 105,
  "limit": 48,
  "products": [...]
}
```

### GET /

Health check — muestra cuántos productos hay en la DB.

### POST /admin/sync

Fuerza un sync completo. Requiere header `x-admin-key`.

---

## Flujo automático

1. Se edita un producto en Shopify
2. Shopify llama al webhook `/webhooks/products/update`
3. Tu servidor actualiza ese producto en PostgreSQL
4. La próxima vez que alguien cargue la colección, ve los datos actualizados

Adicionalmente, el cron job corre a las 3am todos los días y hace un sync
completo de todos los productos para asegurar consistencia.
