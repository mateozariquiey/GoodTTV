// GoodTTV para Android (README.md): una WebView con la página de ../web, que se compila con Vite y entra en los assets
// del APK, y Media3 con el empalme en otra WebView sin mostrar (el motor). Las versiones release se firman con la clave
// propia, que vive fuera del repo.
import java.util.Properties
import javax.inject.Inject

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// La raíz del monorepo: allí están el node_modules que instala bun y los paquetes comunes.
val raiz: Directory = rootProject.layout.projectDirectory.dir("../..")

// La ficha de la firma: un .properties con «archivo» (el almacén PKCS12, relativo a la ficha), «alias» y «contrasena».
// Por defecto, en ~/.local/share/goodttv/firma; otra ruta, con -Pgoodttv.firma=… o en ~/.gradle/gradle.properties.
val fichaFirma: File = file(
    providers.gradleProperty("goodttv.firma")
        .getOrElse("${System.getProperty("user.home")}/.local/share/goodttv/firma/firma.properties"),
)

android {
    namespace = "io.github.mateozariquiey.goodttv"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.mateozariquiey.goodttv"
        minSdk = 33 // Android 13: el teléfono es Android 16 (D19), y así Atrás llega por un solo camino
        targetSdk = 36
        // La versión de la familia (D18); el código, para que Android instale cada una encima de la anterior:
        // mayor × 10 000 + menor × 100 + parche.
        versionCode = 400
        versionName = "0.4.0"
        // Si la WebView se puede inspeccionar por CDP (chrome://inspect): solo en las variantes para depurar y medir.
        buildConfigField("boolean", "CDP", "false")
        // Si escribe la batería en logcat para medir la potencia (Bateria.kt): solo en la variante para medir.
        buildConfigField("boolean", "MEDIDA", "false")
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        create("propia") {
            if (fichaFirma.isFile) {
                val ficha = Properties().apply { fichaFirma.inputStream().use(::load) }
                storeFile = fichaFirma.resolveSibling(ficha.getProperty("archivo"))
                storeType = "PKCS12"
                storePassword = ficha.getProperty("contrasena")
                keyAlias = ficha.getProperty("alias")
                keyPassword = ficha.getProperty("contrasena") // en PKCS12, la misma que la del almacén
            }
        }
    }

    buildTypes {
        debug {
            // Con otro id, la de depuración (firmada con la clave de depuración del SDK) convive con la release en el
            // mismo aparato: si compartieran id, pasar de una a otra obligaría a desinstalar y perder los datos.
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            buildConfigField("boolean", "CDP", "true")
            manifestPlaceholders["nombre"] = "GoodTTV debug"
        }
        release {
            // Sin la ficha, el APK sale sin firmar (app-release-unsigned.apk) y no se puede instalar.
            signingConfig = if (fichaFirma.isFile) signingConfigs["propia"] else null
            manifestPlaceholders["nombre"] = "GoodTTV"
        }
        // Para medir los reproductores (medir/medir.mjs): como la release, sin depurar, porque una app depurable corre con
        // ART en modo depuración y gastaría más CPU en Media3; pero con CDP para leer la WebView, otro id y la clave de
        // depuración del SDK.
        create("medida") {
            initWith(getByName("release"))
            applicationIdSuffix = ".medida"
            versionNameSuffix = "-medida"
            signingConfig = signingConfigs["debug"]
            matchingFallbacks += "release"
            buildConfigField("boolean", "CDP", "true")
            buildConfigField("boolean", "MEDIDA", "true")
            manifestPlaceholders["nombre"] = "GoodTTV medida"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.media3:media3-exoplayer:1.11.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.11.1")
    implementation("androidx.media3:media3-ui:1.11.1")
    implementation("androidx.media3:media3-session:1.11.1") // los mandos del sistema: notificación, bloqueo, auriculares
    implementation("androidx.webkit:webkit:1.14.0") // mensajes con ArrayBuffer entre la app y el motor (Motor.kt)
    implementation("androidx.browser:browser:1.10.0") // Custom Tabs: twitch.tv/activate al vincular la cuenta
}

if (!fichaFirma.isFile) logger.warn("Sin la ficha de la firma ($fichaFirma): la release saldrá sin firmar.")

// Compila la página con el tsc y el Vite de la raíz (bun install --frozen-lockfile): apps/android no es un espacio de
// trabajo de bun, para no dejar en el bun.lock que se publica uno que el repo público no tiene (D20). Primero los tipos,
// porque vite build no los comprueba.
abstract class CompilarWeb @Inject constructor(private val procesos: ExecOperations) : DefaultTask() {
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val fuentes: ConfigurableFileCollection

    @get:Internal
    abstract val monorepo: DirectoryProperty

    @get:OutputDirectory
    abstract val salida: DirectoryProperty

    @TaskAction
    fun compilar() {
        val raiz = monorepo.get().asFile
        procesos.exec {
            workingDir = raiz
            commandLine("node_modules/.bin/tsc", "--noEmit", "-p", "apps/android/web")
        }
        procesos.exec {
            workingDir = raiz
            commandLine(
                "node_modules/.bin/vite", "build", "--config", "apps/android/web/vite.config.ts",
                "--outDir", salida.get().asFile.path,
            )
        }
    }
}

// Una compilación por variante; su salida entra en los assets del APK (AGP le da la carpeta).
androidComponents {
    onVariants { variant ->
        val tarea = tasks.register<CompilarWeb>("compilarWeb${variant.name.replaceFirstChar(Char::uppercase)}") {
            monorepo.set(raiz)
            fuentes.from(
                fileTree(rootProject.file("web")) { exclude("dist") },
                fileTree(raiz.dir("packages")) { include("*/src/**", "*/package.json") },
                raiz.files("package.json", "bun.lock", "tsconfig.base.json"),
            )
        }
        variant.sources.assets?.addGeneratedSourceDirectory(tarea, CompilarWeb::salida)
    }
}
