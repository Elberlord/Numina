# Númina — Firebase completa v1

Esta versión integra el control de acceso de Firebase dentro de la aplicación completa de Númina.

## Funciones conservadas

- Campañas con rangos numéricos personalizados.
- Varias ventas del mismo número o números exclusivos.
- Cliente, teléfono, cantidad, monto, pago y notas.
- Edición de ventas.
- Apertura y cierre de campañas para todos los dispositivos autorizados.
- Consulta manual por número y agrupación de coincidencias.
- Control de entregas.
- Reportes para imprimir o guardar como PDF.
- Exportación CSV y respaldo JSON.
- Importación JSON y migración de datos locales de la versión anterior.

## Control de acceso

- El administrador inicia sesión con correo y contraseña de Firebase.
- Los demás teléfonos o tabletas usan una identidad anónima única de Firebase.
- Cada instalación solicita autorización y muestra un código corto.
- Solo el UID administrativo puede aprobar, revocar o reactivar dispositivos.
- El administrador dispone de 7 días offline.
- Los operadores disponen de 24 horas offline por defecto.
- Los cambios realizados sin conexión quedan en la cola local de Firestore y se sincronizan automáticamente.
- Las reglas de Firestore rechazan las operaciones pendientes si el dispositivo fue revocado antes de sincronizar.

## Configuración obligatoria en Firebase

### 1. Authentication

Mantén activo **Correo electrónico/Contraseña**.

Activa además:

**Authentication → Método de acceso → Anónimo → Habilitar → Guardar**

El acceso anónimo se usa para dar a cada instalación un UID distinto. Un UID anónimo no obtiene acceso a los datos hasta que el administrador crea su documento activo en `devices`.

### 2. Firestore Rules

Abre:

**Firestore Database → Reglas**

Reemplaza las reglas actuales por el contenido de `firestore.rules` y pulsa **Publicar**.

Las reglas anteriores del módulo de acceso no permiten las colecciones operativas. Debes publicar las reglas incluidas en este paquete antes de probar ventas, campañas o consultas.

### 3. Dominios autorizados

Conserva:

- `elberlord.github.io`
- `nomina-23755.firebaseapp.com`
- `nomina-23755.web.app`

## Publicar en GitHub Pages

1. Haz una copia de la versión estable actual.
2. Extrae este ZIP.
3. Sube el contenido interno a la raíz del repositorio `Numina`.
4. Reemplaza los archivos anteriores.
5. Espera a que GitHub Pages termine de publicar.
6. Abre `https://elberlord.github.io/Numina/` en una ventana privada para la primera prueba.

`index.html` debe estar en la raíz del repositorio, no dentro de otra carpeta.

## Primer acceso del administrador

1. Abre Númina en la PC.
2. Ingresa con `anakinjd1985@gmail.com` y tu contraseña privada de Firebase.
3. Firebase valida el UID administrativo configurado.
4. Crea un PIN local de 4 a 8 números.
5. Se abre Númina completa.
6. El permiso offline de esa PC será de 7 días desde la última validación en línea.

## Autorizar otro dispositivo

1. La persona abre o instala Númina.
2. Pulsa **Solicitar acceso para este dispositivo**.
3. Escribe su nombre y el nombre del equipo.
4. Te comunica el código corto mostrado.
5. En tu PC entra a **Dispositivos**.
6. Pulsa **Autorizar** en la solicitud correcta.
7. La otra persona pulsa **Comprobar aprobación** y crea su PIN.

## Revocar un dispositivo

En **Dispositivos**, pulsa **Revocar**.

- Si el teléfono está conectado, se bloquea al recibir la actualización.
- Si está offline, podrá continuar hasta vencer su permiso local.
- Las escrituras pendientes serán rechazadas al sincronizar si el dispositivo ya fue revocado.

## Migrar la versión anterior

Si el navegador conserva la base local anterior, el Resumen mostrará **Datos locales anteriores encontrados**. Pulsa **Migrar datos anteriores** para copiarlos a Firestore. Los usuarios locales antiguos no se migran; se conservan los nombres de quienes registraron las ventas.

## Archivos principales

- `index.html`: interfaz completa.
- `app.bundle.js`: aplicación y SDK de Firebase empaquetados para trabajar offline.
- `styles.css`: diseño adaptable.
- `firestore.rules`: reglas nuevas obligatorias.
- `sw.js`: caché PWA.
- `manifest.webmanifest`: instalación Android y Windows.
- `src/app-src.js`: fuente para mantenimiento.

## Notas de seguridad

- La configuración web de Firebase es pública por diseño.
- No compartas la contraseña del administrador.
- No elimines y recrees la cuenta administrativa: cambiaría su UID.
- El PIN local protege la interfaz, pero la seguridad de servidor depende de Firebase Authentication y Firestore Rules.
- La caché de Firestore permanece en el almacenamiento protegido por el navegador y el sistema operativo; un teléfono perdido debe revocarse cuanto antes.
