# Build reproducible de Númina

La versión 3.6.1 ya no depende de editar manualmente `app.bundle.js`.
El bundle final se genera desde `src/app-src.js` y los módulos de `src/modules/`.

## Requisitos

- Node.js 20 o superior.
- No se necesitan dependencias externas para compilar: el runtime Firebase usado por esta versión está fijado en `vendor/firebase-runtime.js`.

## Comandos

```bash
npm ci
npm run check
npm run build
npm run verify
npm run test:smoke
```

También puede ejecutarse todo el proceso principal con:

```bash
npm run release:check
```

## Qué hace cada comando

- `npm run check`: comprueba sintaxis ESM, imports, exports y dependencias circulares.
- `npm run build`: sincroniza la versión y genera atómicamente `app.bundle.js` desde los módulos.
- `npm run build:dev`: genera `app.bundle.dev.js` con separadores visibles por módulo.
- `npm run verify`: comprueba los archivos de distribución, versión, referencias HTML y sintaxis del bundle.
- `npm run test:smoke`: verifica estructura HTML, selectores DOM y bloque de arranque sin conectarse a Firebase.

## Flujo correcto para una modificación

1. Editar únicamente los archivos de `src/`.
2. Ejecutar `npm run check`.
3. Ejecutar `npm run build`.
4. Ejecutar `npm run verify` y `npm run test:smoke`.
5. Probar la PWA en un alojamiento HTTPS antes de publicarla.
6. Empaquetar el proyecto completo.

## Versionado

La versión se lee desde `package.json`. Durante la build se actualizan automáticamente:

- `VERSION.txt`;
- `APP_VERSION` en `src/modules/context.js`;
- `CACHE_NAME` en `sw.js`;
- `STABILITY_VERSION` en `stability.js`;
- `STABILITY_VERSION` en `src/stability-src.js`.

No deben editarse esos valores por separado.

## Runtime Firebase fijado

`vendor/firebase-runtime.js` contiene el runtime Firebase que ya utilizaba el bundle estable de Númina. Esto permite reconstruir el bundle sin depender de una descarga externa ni cambiar la versión efectiva del SDK accidentalmente.

Cuando se decida actualizar Firebase, debe hacerse como una migración separada y con pruebas específicas de autenticación, Firestore y persistencia offline.
