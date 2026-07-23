# Númina Serie v3.6.1

PWA para administración de campañas y registros, con Firebase Authentication, Firestore, autorización de dispositivos, PIN local, persistencia offline, respaldos, CSV, impresión y diagnóstico.

## Estado técnico

La versión 3.6.1 repara la modularización introducida en la v3.6 y añade una build reproducible. `app.bundle.js` se genera ahora desde los módulos reales de `src/`.

## Estructura principal

```text
src/app-src.js
src/modules/context.js
src/modules/core.js
src/modules/domain.js
src/modules/data.js
src/modules/ui.js
src/modules/admin.js
vendor/firebase-runtime.js
scripts/
```

Consulta `src/MAPA_MODULOS.txt` para ver la responsabilidad de cada archivo.

## Compilación

```bash
npm ci
npm run release:check
npm run test:smoke
```

Las instrucciones completas están en `BUILD.md`.

## Publicación

1. Ejecuta la build y las verificaciones.
2. Copia todos los archivos de la carpeta del proyecto al alojamiento HTTPS.
3. No publiques `app.bundle.dev.js` si lo generaste para desarrollo.
4. Cierra y vuelve a abrir la PWA para que el nuevo service worker sustituya la caché anterior.

## Firestore

Esta reparación no requiere cambiar las reglas de Firestore.

## Seguridad y recuperación

- Claves temporales de un solo uso.
- PIN local reforzado.
- Dispositivos revocables.
- Persistencia offline con vencimiento.
- Validación de respaldos.
- Protección CSV.
- Diagnóstico y recuperación de caché.
