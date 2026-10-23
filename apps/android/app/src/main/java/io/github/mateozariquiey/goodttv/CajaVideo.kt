package io.github.mateozariquiey.goodttv

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.Rect
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageButton
import androidx.media3.ui.PlayerView
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.roundToInt

private const val CAPA_MS = 3000L // los controles del minirreproductor se ocultan solos

// El vídeo del canal en MainActivity: el PlayerView de Media3 en una caja que va a uno de estos sitios.
//   - PAGINA: debajo de la WebView, donde la página lo pide (zonaPedida); los toques y los controles son de la página.
//   - MINI: encima de la página, en una esquina, al volver a Inicio con el canal abierto, como en la app de Twitch. Se
//     arrastra (y se queda en la esquina más cercana), se hace más grande o más pequeño con dos dedos, y al tocarlo salen
//     sus controles: pausa, cerrar y ampliar (volver al canal; también con dos toques).
//   - PIP: el de Android, al salir de la app con el canal abierto: la actividad entera se encoge y solo se ve el vídeo.
// Encima o debajo de la WebView según su Z: el SurfaceView abre su agujero donde se pinta la caja. Se coloca con su
// tamaño y su traslación desde la esquina del marco (dentro de su margen): mover la traslación no recoloca nada más.
@SuppressLint("ViewConstructor")
class CajaVideo(
    contexto: Context,
    private val alAmpliar: () -> Unit,
    private val alCerrar: () -> Unit,
    private val alPausar: (Boolean) -> Unit,
    private val alMover: () -> Unit, // ha cambiado dónde está (para el PiP, que anima desde ahí)
) : FrameLayout(contexto) {
    enum class Sitio { OCULTO, PAGINA, MINI, PIP }

    val vista = PlayerView(contexto)
    var sitio = Sitio.OCULTO
        private set

    private val dp = resources.displayMetrics.density
    private val margen = (12 * dp).roundToInt()
    private val margenArriba = (64 * dp).roundToInt() // la barra de arriba de Inicio queda libre
    private val zona = Rect() // la última que pidió la página
    private var miniAncho = 0 // 0 hasta que se minimiza por primera vez
    private var derecha = true // la esquina del minirreproductor
    private var abajo = true

    private val capa = FrameLayout(contexto)
    private val ocultarCapa = Runnable { capa.visibility = GONE }
    private val pausa = boton(R.drawable.mini_pausa, "Pausa", Gravity.CENTER, 56) { alPausar(!pausado) }

    // Para el icono de pausa o reproducir (lo dice el estado del reproductor).
    var pausado = false
        set(valor) {
            field = valor
            pausa.setImageResource(if (valor) R.drawable.mini_reproducir else R.drawable.mini_pausa)
            pausa.contentDescription = if (valor) "Reproducir" else "Pausa"
        }

    init {
        setBackgroundColor(Color.BLACK)
        visibility = GONE
        vista.useController = false // los controles son de la página o de la capa
        addView(vista, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        capa.setBackgroundColor(0x66000000)
        capa.visibility = GONE
        capa.addView(pausa)
        capa.addView(boton(R.drawable.mini_ampliar, "Volver al canal", Gravity.TOP or Gravity.START, 44) { alAmpliar() })
        capa.addView(boton(R.drawable.mini_cerrar, "Cerrar", Gravity.TOP or Gravity.END, 44) { alCerrar() })
        addView(capa, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    private fun boton(icono: Int, nombre: String, donde: Int, lado: Int, alPulsar: () -> Unit) = ImageButton(context).apply {
        setImageResource(icono)
        contentDescription = nombre
        background = null
        scaleType = android.widget.ImageView.ScaleType.CENTER_INSIDE
        val relleno = (10 * dp).roundToInt()
        setPadding(relleno, relleno, relleno, relleno)
        layoutParams = LayoutParams((lado * dp).roundToInt(), (lado * dp).roundToInt(), donde)
        setOnClickListener {
            alPulsar()
            mostrarCapa()
        }
    }

    // Lo que mide el marco por dentro de su margen (las barras del sistema, la cámara, el teclado).
    private val anchoMarco get() = (parent as? ViewGroup)?.let { it.width - it.paddingLeft - it.paddingRight } ?: 0
    private val altoMarco get() = (parent as? ViewGroup)?.let { it.height - it.paddingTop - it.paddingBottom } ?: 0

    private fun colocar(ancho: Int, alto: Int, x: Float, y: Float) {
        animate().cancel()
        val lp = layoutParams as FrameLayout.LayoutParams
        if (lp.width != ancho || lp.height != alto || lp.gravity != (Gravity.TOP or Gravity.START)) {
            lp.width = ancho
            lp.height = alto
            lp.gravity = Gravity.TOP or Gravity.START
            layoutParams = lp
        }
        translationX = x
        translationY = y
    }

    // Donde la página reserva el vídeo, en píxeles desde su esquina. Se guarda siempre: si llega estando en la esquina
    // (al volver al canal, la página la manda antes de abrirlo), vale para cuando vuelva a la página.
    fun zonaPedida(nueva: Rect) {
        zona.set(nueva)
        if (sitio != Sitio.PAGINA) return
        colocar(zona.width(), zona.height(), zona.left.toFloat(), zona.top.toFloat())
        alMover()
    }

    fun enPagina() {
        sitio = Sitio.PAGINA
        visibility = VISIBLE
        translationZ = 0f // debajo de la WebView
        quitarCapa()
        colocar(zona.width(), zona.height(), zona.left.toFloat(), zona.top.toFloat())
        alMover()
    }

    fun enMini() {
        sitio = Sitio.MINI
        visibility = VISIBLE
        translationZ = 12 * dp // encima de la WebView, con sombra
        quitarCapa()
        if (miniAncho == 0) miniAncho = (0.55f * min(anchoMarco, altoMarco)).roundToInt()
        recolocar()
    }

    fun enPip() {
        sitio = Sitio.PIP
        visibility = VISIBLE
        translationZ = 0f
        quitarCapa()
        colocar(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT, 0f, 0f)
    }

    fun ocultar() {
        sitio = Sitio.OCULTO
        quitarCapa()
        visibility = GONE
    }

    // Tras cambiar el marco (girar, el teclado, salir del PiP): el minirreproductor, dentro y en su esquina.
    fun recolocar() {
        if (sitio != Sitio.MINI || anchoMarco == 0) return
        miniAncho = miniAncho.coerceIn(minimo(), maximo())
        val alto = miniAncho * 9 / 16
        colocar(miniAncho, alto, esquinaX(miniAncho), esquinaY(alto))
        alMover()
    }

    private fun minimo() = (0.4f * min(anchoMarco, altoMarco)).roundToInt()

    private fun maximo() = maxOf(minimo(), min(anchoMarco - 2 * margen, (altoMarco - margen - margenArriba) * 16 / 9))

    private fun esquinaX(ancho: Int) = (if (derecha) anchoMarco - ancho - margen else margen).toFloat()

    private fun esquinaY(alto: Int) = (if (abajo) altoMarco - alto - margen else margenArriba).toFloat()

    private fun mostrarCapa() {
        capa.visibility = VISIBLE
        removeCallbacks(ocultarCapa)
        postDelayed(ocultarCapa, CAPA_MS)
    }

    fun quitarCapa() {
        removeCallbacks(ocultarCapa)
        capa.visibility = GONE
    }

    // Los gestos, solo en la esquina: arrastrar, dos dedos para el tamaño (sin moverse del centro), tocar para los
    // controles y dos toques para volver al canal. Al soltar, a la esquina más cercana. El arrastre se mide en la
    // pantalla (rawX), no en la caja: la caja se mueve con el dedo, y medido en ella se perdería por el camino.
    private val umbral = ViewConfiguration.get(contexto).scaledTouchSlop
    private var arrastrando = false
    private var dedoX = 0f
    private var dedoY = 0f
    private var desdeX = 0f
    private var desdeY = 0f

    private val gestos = GestureDetector(contexto, object : GestureDetector.SimpleOnGestureListener() {
        override fun onDown(e: MotionEvent) = true

        override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
            if (capa.visibility == VISIBLE) quitarCapa() else mostrarCapa()
            return true
        }

        override fun onDoubleTap(e: MotionEvent): Boolean {
            alAmpliar()
            return true
        }
    })

    private val escala = ScaleGestureDetector(contexto, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(detector: ScaleGestureDetector): Boolean {
            val ancho = (miniAncho * detector.scaleFactor).roundToInt().coerceIn(minimo(), maximo())
            if (ancho == miniAncho) return true
            val centroX = translationX + miniAncho / 2f
            val centroY = translationY + miniAncho * 9 / 32f
            miniAncho = ancho
            colocar(ancho, ancho * 9 / 16, centroX - ancho / 2f, centroY - ancho * 9 / 32f)
            return true
        }
    })

    @SuppressLint("ClickableViewAccessibility") // tocar ya tiene botones en la capa; con TalkBack, los de la capa
    override fun onTouchEvent(evento: MotionEvent): Boolean {
        if (sitio != Sitio.MINI) return false
        escala.onTouchEvent(evento)
        gestos.onTouchEvent(evento)
        when (evento.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                arrastrando = false
                desde(evento, 0)
            }
            // Al poner o quitar un dedo, el arrastre sigue desde ahí (con el dedo que queda).
            MotionEvent.ACTION_POINTER_DOWN -> desde(evento, 0)
            MotionEvent.ACTION_POINTER_UP -> desde(evento, if (evento.actionIndex == 0) 1 else 0)
            MotionEvent.ACTION_MOVE -> if (!escala.isInProgress && evento.pointerCount == 1) {
                val dx = evento.rawX - dedoX
                val dy = evento.rawY - dedoY
                if (!arrastrando && hypot(dx, dy) > umbral) arrastrando = true
                if (arrastrando) {
                    translationX = desdeX + dx
                    translationY = desdeY + dy
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> aLaEsquina()
        }
        return true
    }

    private fun desde(evento: MotionEvent, dedo: Int) {
        animate().cancel()
        dedoX = evento.getRawX(dedo)
        dedoY = evento.getRawY(dedo)
        desdeX = translationX
        desdeY = translationY
    }

    private fun aLaEsquina() {
        val alto = miniAncho * 9 / 16
        derecha = translationX + miniAncho / 2f > anchoMarco / 2f
        abajo = translationY + alto / 2f > altoMarco / 2f
        animate().translationX(esquinaX(miniAncho)).translationY(esquinaY(alto)).setDuration(180)
            .withEndAction(alMover).start()
    }
}
