# GoodTTV para Android

La versión para el teléfono, experimental desde la 0.3.0: la interfaz web en una WebView, el empalme en un motor oculto
y el vídeo con Media3, que sigue sonando con la pantalla apagada. Tiene las pantallas para el dedo: Inicio (seguidos en
directo, recientes, vídeos a medias y populares), la búsqueda, el canal con el vídeo, el chat (con emotes para escribir)
y sus vídeos, los VOD y retroceder el directo, y la cuenta y los ajustes. El vídeo va debajo de la página, que es
transparente en su sitio y pinta encima los controles. Como en la app de Twitch, al volver a Inicio el canal sigue en
una esquina, al salir de la app pasa al PiP de Android, deslizar hacia abajo sobre el vídeo vuelve atrás, y un botón lo
pone a pantalla completa en horizontal. Lo que suena se maneja desde la notificación, la pantalla de bloqueo y los
auriculares. B (hls.js en la página, como la extensión) queda solo para medir.

```text
web/                     las páginas (Vite, TypeScript); Gradle las compila y las mete en los assets del APK
├── pagina.tsx           index.html: monta las pantallas, con window.api y la red de la app
├── pantallas/           Inicio, la búsqueda, el canal, el VOD, el chat y la cuenta, para el dedo
│   ├── media3.ts        habla con el vídeo nativo (un canal o un VOD); guarda por dónde va un VOD y los minutos vistos
│   ├── controles.tsx    lo de encima del vídeo que comparten el canal y el VOD: pausa con 10 s, hojas y pestañas
│   ├── BarraTiempo.tsx  la barra del VOD y del directo con su VOD (DVR-1), con las miniaturas al arrastrar
│   ├── Vod.tsx          un VOD (VOD-1): por dónde va, velocidad, calidad, su chat y los demás vídeos del canal
│   ├── Videos.tsx       los vídeos de un canal (COL-2), con los suyos a medias encima, y los de Inicio
│   ├── Busqueda.tsx     la búsqueda de invitado, por relevancia, como twitch.tv
│   └── Emotes.tsx       los emotes al escribir (CHAT-1): sugerencias, la lista entera y la ficha de uno del chat
├── estilos.css          la identidad de la familia (como la extensión), a escala de dedo
├── medir-b.tsx          B, solo para medir: index.html?reproductor=b, con hls.js en la página (como la extensión)
├── api.ts               window.api (createPageApi, como la extensión), con la sesión que guarda la app
├── motor.ts             motor.html: solo el empalme, para Media3 (sin reproductor ni interfaz)
└── red-nativa.ts        lo que Twitch no deja pedir desde la página va a /red, que atiende la app; los emotes, directos
app/src/main/…/goodttv/  el proyecto de Android (Kotlin)
├── MainActivity.kt      la WebView visible, con Media3 debajo, y su puente con la página; Atrás recorre su historial
├── CajaVideo.kt         dónde va el vídeo: debajo de la página, en la esquina (minirreproductor) o en el PiP
├── Sesion.kt            la sesión de Twitch, cifrada con una clave del Keystore
├── Paginas.kt           sirve las páginas desde el APK y /red; no carga páginas ajenas (twitch.tv, en una Custom Tab)
├── RedNativa.kt         /red: la petición a Twitch, sin Origin, solo a sus hosts
├── Reproductor.kt       Media3 con el motor, colocado a 2 s del directo, o con un VOD; uno cada vez
├── ReproductorActivity.kt  Media3 a pantalla completa, solo para medir: una muestra por segundo en logcat
├── Motor.kt             la WebView sin mostrar con motor.html, y los mensajes con ella
├── MotorDataSource.kt   el DataSource de Media3 que pide al motor la lista, info y los trozos del VOD
├── Mando.kt             lo que ven los mandos del sistema (la notificación, el bloqueo, los auriculares): reproducir y pausar
├── FondoService.kt      servicio en primer plano «mediaPlayback», para seguir con la pantalla apagada, con los mandos
└── Bateria.kt           solo en la variante medida: la corriente de la batería en logcat, una muestra por segundo
```

No es un espacio de trabajo de bun (no tiene `package.json`): la página usa el `node_modules` de la raíz. Ahí
Vite está porque lo declaran la tele y la extensión; TypeScript, porque lo declara la raíz.

## Entorno

Hacen falta el SDK de Android y un JDK 21 (en estos ejemplos, en `~/Android/Sdk` y `~/Android/jdk`). Gradle 8.14.3 lo
descarga el *wrapper* (`./gradlew`); el plugin de Android (8.13) y Kotlin (2.2.20), la primera compilación. Gradle
8.14 no arranca con Java 25: hace falta `JAVA_HOME`.

```bash
export ANDROID_HOME=~/Android/Sdk JAVA_HOME=~/Android/jdk
export PATH=$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH
```

Para montarlo en un equipo nuevo: el JDK 21 de Temurin, las
[herramientas de línea de órdenes](https://developer.android.com/studio#command-line-tools-only) en
`~/Android/Sdk/cmdline-tools/latest` y, con ellas:

```bash
sdkmanager "platform-tools" "emulator" "platforms;android-36" "build-tools;35.0.0" \
  "system-images;android-36;google_apis;x86_64"
```

## Compilar

Desde la raíz del repo, con `bun install --frozen-lockfile` hecho:

```bash
cd apps/android
./gradlew assembleDebug     # app/build/outputs/apk/debug/app-debug.apk, firmada con la clave de depuración
./gradlew assembleRelease   # app/build/outputs/apk/release/app-release.apk, firmada con la clave propia
./gradlew lintRelease       # el lint de Android: app/build/reports/lint-results-release.txt
```

Cada compilación pasa antes `tsc` y `vite build` sobre `web/` (`compilarWebDebug` y `compilarWebRelease` en
`app/build.gradle.kts`). Si no ha cambiado la página, ni un paquete común, ni el `package.json`, el `bun.lock` o el
`tsconfig.base.json` de la raíz, Gradle se los salta. `bun run verify` no compila el APK ni necesita el SDK: solo
revisa `web/` con Biome (el `biome.json` de aquí deja fuera las carpetas `build/`).

La de depuración (`io.github.mateozariquiey.goodttv.debug`, «GoodTTV debug») y la release
(`io.github.mateozariquiey.goodttv`, «GoodTTV») conviven en el mismo aparato.

## La firma

La release se firma con una clave propia que **nunca entra en el repo**. Android solo instala una versión nueva encima
de otra firmada con la misma clave: si se pierde, para actualizar la app habrá que desinstalarla y perder sus datos.
Para firmar la tuya, una ficha `firma.properties` con `archivo` (el almacén PKCS12), `alias` y `contrasena`, y
`./gradlew assembleRelease -Pgoodttv.firma=/ruta/firma.properties` (o `goodttv.firma=…` en
`~/.gradle/gradle.properties`). Sin la ficha, Gradle avisa y la release sale sin firmar (`app-release-unsigned.apk`),
que no se puede instalar.

## Instalar

Con `adb` y la depuración USB o inalámbrica activada en el teléfono:
`adb install -r app/build/outputs/apk/release/app-release.apk`. `-r` instala encima de la que hay, sin perder la cuenta,
si va firmada con la misma clave. La de depuración y la release son dos apps distintas.

## Abrir un canal sin tocar el teléfono

```bash
# La pantalla del canal de la app (Media3 debajo de la página)
adb -s <aparato> shell am start -n io.github.mateozariquiey.goodttv/.MainActivity --es ruta "'/index.html#/canal/<canal>'"
# Un VOD (y, al retroceder un directo, con ?t=<segundo>&directo=<canal>)
adb -s <aparato> shell am start -n io.github.mateozariquiey.goodttv/.MainActivity --es ruta "'/index.html#/vod/<id>'"
# B, en la WebView, solo para medir (?registro expone lo que lee la medida)
adb -s <aparato> shell am start -n io.github.mateozariquiey.goodttv/.MainActivity --es ruta "'/index.html?reproductor=b#/canal/<canal>'"
# A a pantalla completa, para medir (--ez fondo true: sigue con la pantalla apagada; --ez registro true: eventos del
# empalme)
adb -s <aparato> shell am start -n io.github.mateozariquiey.goodttv/.ReproductorActivity --es canal <canal>
adb -s <aparato> logcat -s GoodTTVMedia3 GoodTTVEmpalme GoodTTVRed GoodTTVPagina
```

En la de depuración, el paquete es `io.github.mateozariquiey.goodttv.debug` y la actividad hay que darla entera
(`…goodttv.debug/io.github.mateozariquiey.goodttv.MainActivity`).

## Depurar la página

En las variantes debug y medida, la WebView admite CDP:

```bash
adb -s <aparato> forward tcp:9333 localabstract:webview_devtools_remote_$(adb -s <aparato> shell pidof io.github.mateozariquiey.goodttv.debug)
curl http://127.0.0.1:9333/json/list   # o chrome://inspect en Chrome
```

Los mensajes de la consola de la página van a logcat con la etiqueta `GoodTTVPagina`.
