# Númina — versión estática para GitHub Pages

Esta carpeta contiene una PWA completa que se puede publicar directamente en GitHub Pages, abrir desde Chrome en Android e instalar como aplicación.

## Qué permite probar

- Instalación en Android desde Chrome.
- Funcionamiento sin conexión después de la primera carga.
- Administrador y usuarios locales con PIN.
- Campañas con rangos personalizados.
- Varias ventas del mismo número o números exclusivos.
- Cliente, teléfono, cantidad, monto, estado y vendedora.
- Registro manual de un resultado externo.
- Lista de personas coincidentes y cantidad de participaciones.
- Entregas pendientes o realizadas.
- Exportación de respaldo JSON.
- Importación de respaldo JSON.
- Exportación CSV.
- Reportes que se pueden guardar como PDF.

## Límite importante de esta versión

GitHub Pages sirve archivos estáticos y no incluye una base de datos privada. Por eso, **cada teléfono guarda una base independiente**. Los usuarios, ventas y resultados de un teléfono no aparecen automáticamente en los demás.

Esta versión es adecuada para instalar y probar la interfaz y el modo offline. Para que varios vendedores compartan la misma información se debe conectar después a Firebase, Supabase u otro servidor.

## Cómo subirla a GitHub Pages

1. Crea un repositorio nuevo en GitHub.
2. Descomprime este paquete.
3. Sube todos los archivos y carpetas al nivel principal del repositorio. `index.html` debe quedar en la raíz.
4. Abre **Settings → Pages**.
5. En **Build and deployment**, elige **Deploy from a branch**.
6. Selecciona la rama `main` y la carpeta `/ (root)`.
7. Pulsa **Save**.
8. GitHub mostrará la dirección pública de la aplicación cuando termine la publicación.

## Cómo instalarla en Android

1. Abre la dirección de GitHub Pages en Chrome.
2. Crea el administrador local.
3. Abre el menú de Chrome.
4. Selecciona **Instalar aplicación** o **Agregar a pantalla principal**.
5. Abre la app instalada al menos una vez con internet para que se guarden los archivos offline.

## Respaldos

Cada teléfono debe exportar su archivo JSON regularmente. No borres los datos de Chrome ni desinstales la app antes de generar un respaldo.

El PDF se genera mediante la opción de impresión del navegador. En Android selecciona **Guardar como PDF**.
