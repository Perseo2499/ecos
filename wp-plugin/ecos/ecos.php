<?php
/**
 * Plugin Name:       Ecos para WordPress
 * Plugin URI:        https://github.com/Perseo2499/ecos
 * Description:       Complemento de Ecos: carga una sola vez el carrusel de fotos, los vídeos y los estilos de Ecos, añade la vista previa al compartir y los datos para Google, cuenta visitas sin cookies, vacía la caché de la entrada cuando la envías desde Ecos y avisa si otra persona la está editando, guarda los campos personalizados y los idiomas, guarda las notas internas de revisión entre varias personas, exporta la configuración para la copia de emergencia de Ecos, ofrece al editor los colores, tamaños y fuentes de tu tema, la vista previa exacta con el tema y los ajustes de página de Astra, y abre el editor de WordPress dentro de Ecos para editar bloques de otros plugins.
 * Version:           1.8.1
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Perseo2499
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       ecos
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ECOS_WP_VERSION', '1.8.1' );
define( 'ECOS_WP_URL', plugin_dir_url( __FILE__ ) );
define( 'ECOS_WP_DIR', plugin_dir_path( __FILE__ ) );

require_once ECOS_WP_DIR . 'includes/seo.php';
require_once ECOS_WP_DIR . 'includes/stats.php';
require_once ECOS_WP_DIR . 'includes/export.php';
require_once ECOS_WP_DIR . 'includes/theme.php';
require_once ECOS_WP_DIR . 'includes/render.php';
require_once ECOS_WP_DIR . 'includes/editor.php';
require_once ECOS_WP_DIR . 'includes/seo2.php';
require_once ECOS_WP_DIR . 'includes/review.php';
require_once ECOS_WP_DIR . 'includes/fields.php';
require_once ECOS_WP_DIR . 'includes/lang.php';

/**
 * ¿Este contenido usa algo de Ecos? (data-ecos-carousel, ecos-vp o cualquier clase ecos-)
 */
function ecos_wp_content_needs_assets( $content ) {
	// 'ecos-' ya incluye data-ecos-carousel y ecos-vp.
	return is_string( $content ) && false !== strpos( $content, 'ecos-' );
}

/**
 * Encola el CSS y los scripts (en el pie, con defer). Solo una vez por página.
 */
function ecos_wp_enqueue() {
	static $done = false;
	if ( $done ) {
		return;
	}
	$done = true;
	wp_enqueue_style( 'ecos', ECOS_WP_URL . 'assets/ecos.css', array(), ECOS_WP_VERSION );
	$args = array(
		'in_footer' => true,
		'strategy'  => 'defer',
	);
	wp_enqueue_script( 'ecos-carousel', ECOS_WP_URL . 'assets/ecos-carousel.js', array(), ECOS_WP_VERSION, $args );
	wp_enqueue_script( 'ecos-videos', ECOS_WP_URL . 'assets/ecos-videos.js', array(), ECOS_WP_VERSION, $args );
	wp_enqueue_script( 'ecos-anim', ECOS_WP_URL . 'assets/ecos-anim.js', array(), ECOS_WP_VERSION, $args );
}

/**
 * «Más bloques» (pestañas, cifras con contador, donación, evento, puntos, antes/después, preguntas frecuentes):
 * su guion solo se carga si el contenido lleva alguna de sus clases.
 */
function ecos_wp_enqueue_more( $content ) {
	if ( ! is_string( $content ) || ! preg_match( '/ecos-(?:tabs|cifras|donar|evento|puntos|compare|faq-uno)/', $content ) ) {
		return;
	}
	wp_enqueue_script(
		'ecos-more',
		ECOS_WP_URL . 'assets/ecos-more.js',
		array(),
		ECOS_WP_VERSION,
		array(
			'in_footer' => true,
			'strategy'  => 'defer',
		)
	);
}

/**
 * Fuentes de Google (opcionales): solo se cargan las familias que la entrada usa, detectadas por la clase ecos-font-<slug>.
 * Esto conecta con Google (fonts.googleapis.com): ver docs/politica-privacidad-estadisticas.md.
 */
function ecos_wp_google_fonts() {
	return array(
		'inter' => 'Inter:wght@400;700',
		'roboto' => 'Roboto:wght@400;700',
		'open-sans' => 'Open+Sans:wght@400;700',
		'lato' => 'Lato:wght@400;700',
		'montserrat' => 'Montserrat:wght@400;700',
		'poppins' => 'Poppins:wght@400;700',
		'nunito' => 'Nunito:wght@400;700',
		'raleway' => 'Raleway:wght@400;700',
		'merriweather' => 'Merriweather:wght@400;700',
		'playfair-display' => 'Playfair+Display:wght@400;700',
		'lora' => 'Lora:wght@400;700',
		'source-serif' => 'Source+Serif+4:wght@400;700',
		'work-sans' => 'Work+Sans:wght@400;700',
		'rubik' => 'Rubik:wght@400;700',
		'karla' => 'Karla:wght@400;700',
		'dm-sans' => 'DM+Sans:wght@400;700',
		'quicksand' => 'Quicksand:wght@400;700',
		'oswald' => 'Oswald:wght@400;700',
		'bebas-neue' => 'Bebas+Neue',
		'caveat' => 'Caveat:wght@400;700',
	);
}

function ecos_wp_enqueue_fonts( $content ) {
	if ( ! is_string( $content ) || false === strpos( $content, 'ecos-font-' ) ) {
		return;
	}
	if ( ! preg_match_all( '/ecos-font-([a-z-]+)/', $content, $m ) ) {
		return;
	}
	$all = ecos_wp_google_fonts();
	$fam = array();
	foreach ( array_unique( $m[1] ) as $slug ) {
		if ( isset( $all[ $slug ] ) ) {
			$fam[] = 'family=' . $all[ $slug ];
		}
	}
	if ( $fam ) {
		wp_enqueue_style( 'ecos-fonts', 'https://fonts.googleapis.com/css2?' . implode( '&', $fam ) . '&display=swap', array(), null );
	}
}

/**
 * Entradas y páginas sueltas: se decide antes de pintar la cabecera.
 */
function ecos_wp_maybe_enqueue() {
	if ( ! is_singular() ) {
		return;
	}
	$post = get_queried_object();
	if ( $post instanceof WP_Post && ecos_wp_content_needs_assets( $post->post_content ) ) {
		ecos_wp_enqueue();
		ecos_wp_enqueue_fonts( $post->post_content );
		ecos_wp_enqueue_more( $post->post_content );
	}
}
add_action( 'wp_enqueue_scripts', 'ecos_wp_maybe_enqueue' );

/**
 * Listados que muestran el contenido completo: se encola al pintarlo (los scripts salen en el pie).
 */
function ecos_wp_content_filter( $content ) {
	if ( ! is_admin() && ecos_wp_content_needs_assets( $content ) ) {
		ecos_wp_enqueue();
		ecos_wp_enqueue_fonts( $content );
		ecos_wp_enqueue_more( $content );
	}
	return $content;
}
add_filter( 'the_content', 'ecos_wp_content_filter', 5 );

/**
 * Plugins de caché detectados (nombres legibles).
 */
function ecos_wp_detect_caches() {
	$found = array();
	if ( defined( 'LSCWP_V' ) || has_action( 'litespeed_purge_post' ) ) {
		$found[] = 'LiteSpeed Cache';
	}
	if ( function_exists( 'rocket_clean_post' ) ) {
		$found[] = 'WP Rocket';
	}
	if ( function_exists( 'w3tc_flush_post' ) ) {
		$found[] = 'W3 Total Cache';
	}
	if ( function_exists( 'wp_cache_post_change' ) ) {
		$found[] = 'WP Super Cache';
	}
	if ( class_exists( 'WpFastestCache' ) ) {
		$found[] = 'WP Fastest Cache';
	}
	if ( function_exists( 'sg_cachepress_purge_cache' ) ) {
		$found[] = 'SiteGround Optimizer';
	}
	if ( class_exists( 'Breeze_PurgeCache' ) || has_action( 'breeze_clear_all_cache' ) ) {
		$found[] = 'Breeze';
	}
	if ( class_exists( 'WPO_Page_Cache' ) ) {
		$found[] = 'WP-Optimize';
	}
	if ( has_action( 'cloudflare_purge_by_url' ) ) {
		$found[] = 'Cloudflare APO';
	}
	return $found;
}

/**
 * Vacía la caché de una entrada. Devuelve la lista de lo que se ha purgado.
 */
function ecos_wp_purge_post( $id ) {
	$id     = absint( $id );
	$purged = array();
	$url    = get_permalink( $id );

	if ( defined( 'LSCWP_V' ) || has_action( 'litespeed_purge_post' ) ) {
		do_action( 'litespeed_purge_post', $id );
		$purged[] = 'LiteSpeed Cache';
	}
	if ( function_exists( 'rocket_clean_post' ) ) {
		rocket_clean_post( $id );
		$purged[] = 'WP Rocket';
	}
	if ( function_exists( 'w3tc_flush_post' ) ) {
		w3tc_flush_post( $id );
		$purged[] = 'W3 Total Cache';
	}
	if ( function_exists( 'wp_cache_post_change' ) ) {
		wp_cache_post_change( $id );
		$purged[] = 'WP Super Cache';
	}
	if ( class_exists( 'WpFastestCache' ) && isset( $GLOBALS['wp_fastest_cache'] ) && is_object( $GLOBALS['wp_fastest_cache'] ) && method_exists( $GLOBALS['wp_fastest_cache'], 'singleDeleteCache' ) ) {
		$GLOBALS['wp_fastest_cache']->singleDeleteCache( false, $id );
		$purged[] = 'WP Fastest Cache';
	}
	if ( function_exists( 'sg_cachepress_purge_cache' ) && $url ) {
		sg_cachepress_purge_cache( $url );
		$purged[] = 'SiteGround Optimizer';
	}
	if ( class_exists( 'Breeze_PurgeCache' ) || has_action( 'breeze_clear_all_cache' ) ) {
		do_action( 'breeze_clear_all_cache' );
		$purged[] = 'Breeze';
	}
	if ( class_exists( 'WPO_Page_Cache' ) && method_exists( 'WPO_Page_Cache', 'delete_single_post_cache' ) ) {
		WPO_Page_Cache::delete_single_post_cache( $id );
		$purged[] = 'WP-Optimize';
	}
	if ( $url && has_action( 'cloudflare_purge_by_url' ) ) {
		do_action( 'cloudflare_purge_by_url', array( $url ), $id );
		$purged[] = 'Cloudflare APO';
	}

	// Siempre: la caché interna de WordPress para esa entrada.
	clean_post_cache( $id );
	$purged[] = 'WordPress';

	return $purged;
}

/**
 * API REST: ecos/v1/status, purge y lock (solo con permiso para editar entradas).
 */
function ecos_wp_can_edit() {
	return current_user_can( 'edit_posts' );
}

function ecos_wp_validate_id( $value ) {
	return is_numeric( $value ) && (int) $value > 0;
}

function ecos_wp_register_routes() {
	register_rest_route(
		'ecos/v1',
		'/status',
		array(
			'methods'             => 'GET',
			'callback'            => 'ecos_wp_rest_status',
			'permission_callback' => 'ecos_wp_can_edit',
		)
	);
	register_rest_route(
		'ecos/v1',
		'/purge',
		array(
			'methods'             => 'POST',
			'callback'            => 'ecos_wp_rest_purge',
			'permission_callback' => 'ecos_wp_can_edit',
			'args'                => array(
				'id' => array(
					'required'          => true,
					'sanitize_callback' => 'absint',
					'validate_callback' => 'ecos_wp_validate_id',
				),
			),
		)
	);
	register_rest_route(
		'ecos/v1',
		'/lock',
		array(
			array(
				'methods'             => 'POST',
				'callback'            => 'ecos_wp_rest_lock',
				'permission_callback' => 'ecos_wp_can_edit',
				'args'                => array(
					'id'    => array(
						'required'          => true,
						'sanitize_callback' => 'absint',
						'validate_callback' => 'ecos_wp_validate_id',
					),
					'force' => array(
						'required' => false,
						'default'  => false,
					),
				),
			),
			array(
				'methods'             => 'DELETE',
				'callback'            => 'ecos_wp_rest_unlock',
				'permission_callback' => 'ecos_wp_can_edit',
				'args'                => array(
					'id' => array(
						'required'          => true,
						'sanitize_callback' => 'absint',
						'validate_callback' => 'ecos_wp_validate_id',
					),
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'ecos_wp_register_routes' );

function ecos_wp_rest_status() {
	return rest_ensure_response(
		array(
			'plugin'  => 'ecos',
			'version' => ECOS_WP_VERSION,
			'caches'  => ecos_wp_detect_caches(),
			'seo'     => ecos_wp_seo2_info(),
			'stats'   => true,
			'lock'    => true,
			'export'  => true,
			'theme'   => true,
			'render'  => true,
			'editor'  => true,
			'astra'   => ecos_wp_is_astra(),
			'env'     => ecos_wp_env_info(),
		)
	);
}

/**
 * Datos del entorno de la web (1.7.0): versiones, límites de subida, tema y, para administradores, plugins activos.
 * Solo se leen; Ecos los enseña en Conexiones → «Tu web» y avisa de incompatibilidades.
 */
function ecos_wp_env_info() {
	global $wp_version;
	$theme = wp_get_theme();
	$env   = array(
		'wp_version'  => isset( $wp_version ) ? (string) $wp_version : '',
		'php_version' => PHP_VERSION,
		'theme'       => array(
			'name'    => (string) $theme->get( 'Name' ),
			'version' => (string) $theme->get( 'Version' ),
		),
		'limits'      => array(
			'upload_max_filesize' => (string) ini_get( 'upload_max_filesize' ),
			'post_max_size'       => (string) ini_get( 'post_max_size' ),
			'memory_limit'        => (string) ini_get( 'memory_limit' ),
			'wp_max_upload'       => (int) wp_max_upload_size(),
		),
		'rest'        => array(
			'enabled'       => true,
			'app_passwords' => function_exists( 'wp_is_application_passwords_available' ) ? (bool) wp_is_application_passwords_available() : false,
		),
		'multisite'   => is_multisite(),
	);
	// La lista de plugins solo la ven quienes pueden gestionarlos.
	if ( current_user_can( 'activate_plugins' ) ) {
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		$all    = get_plugins();
		$active = (array) get_option( 'active_plugins', array() );
		if ( is_multisite() ) {
			$active = array_merge( $active, array_keys( (array) get_site_option( 'active_sitewide_plugins', array() ) ) );
		}
		$list = array();
		foreach ( array_unique( $active ) as $file ) {
			if ( isset( $all[ $file ] ) ) {
				$list[] = array(
					'slug'    => strpos( $file, '/' ) !== false ? dirname( $file ) : basename( $file, '.php' ),
					'name'    => (string) $all[ $file ]['Name'],
					'version' => (string) $all[ $file ]['Version'],
				);
			}
		}
		$env['plugins'] = $list;
	}
	return $env;
}

function ecos_wp_rest_purge( WP_REST_Request $request ) {
	$id = absint( $request->get_param( 'id' ) );
	if ( ! $id || ! get_post( $id ) ) {
		return new WP_Error( 'ecos_not_found', 'No existe esa entrada.', array( 'status' => 404 ) );
	}
	if ( ! current_user_can( 'edit_post', $id ) ) {
		return new WP_Error( 'ecos_forbidden', 'No tienes permiso para esa entrada.', array( 'status' => 403 ) );
	}
	return rest_ensure_response(
		array(
			'id'     => $id,
			'purged' => ecos_wp_purge_post( $id ),
		)
	);
}

/**
 * Bloqueo de edición estándar de WordPress (meta _edit_lock, el mismo del editor de WordPress).
 * Las funciones wp_check_post_lock() y wp_set_post_lock() viven en wp-admin y en la REST no están cargadas.
 */
function ecos_wp_load_post_lock() {
	if ( ! function_exists( 'wp_check_post_lock' ) || ! function_exists( 'wp_set_post_lock' ) ) {
		require_once ABSPATH . 'wp-admin/includes/post.php';
	}
}

function ecos_wp_lock_user( $user_id ) {
	$user = get_userdata( (int) $user_id );
	if ( ! $user ) {
		return null;
	}
	return array(
		'id'     => (int) $user->ID,
		'name'   => $user->display_name,
		'avatar' => get_avatar_url( $user->ID, array( 'size' => 48 ) ),
	);
}

/**
 * POST ecos/v1/lock { id, force? }: pide el bloqueo. Si otra persona la tiene abierta (últimos 150 s),
 * devuelve quién (locked: true) y no lo toma, salvo con force: true («Editar de todos modos»).
 */
function ecos_wp_rest_lock( WP_REST_Request $request ) {
	$id = absint( $request->get_param( 'id' ) );
	if ( ! $id || ! get_post( $id ) ) {
		return new WP_Error( 'ecos_not_found', 'No existe esa entrada.', array( 'status' => 404 ) );
	}
	if ( ! current_user_can( 'edit_post', $id ) ) {
		return new WP_Error( 'ecos_forbidden', 'No tienes permiso para esa entrada.', array( 'status' => 403 ) );
	}
	ecos_wp_load_post_lock();
	$force = rest_sanitize_boolean( $request->get_param( 'force' ) );
	$other = $force ? false : wp_check_post_lock( $id );
	if ( $other ) {
		return rest_ensure_response(
			array(
				'id'     => $id,
				'locked' => true,
				'user'   => ecos_wp_lock_user( $other ),
			)
		);
	}
	wp_set_post_lock( $id );
	return rest_ensure_response(
		array(
			'id'     => $id,
			'locked' => false,
			'user'   => null,
		)
	);
}

/**
 * DELETE ecos/v1/lock { id }: suelta el bloqueo, solo si es de quien lo pide.
 */
function ecos_wp_rest_unlock( WP_REST_Request $request ) {
	$id = absint( $request->get_param( 'id' ) );
	if ( ! $id || ! get_post( $id ) ) {
		return new WP_Error( 'ecos_not_found', 'No existe esa entrada.', array( 'status' => 404 ) );
	}
	if ( ! current_user_can( 'edit_post', $id ) ) {
		return new WP_Error( 'ecos_forbidden', 'No tienes permiso para esa entrada.', array( 'status' => 403 ) );
	}
	$released = false;
	$lock     = get_post_meta( $id, '_edit_lock', true );
	if ( $lock ) {
		$parts = explode( ':', $lock );
		if ( isset( $parts[1] ) && (int) $parts[1] === get_current_user_id() ) {
			delete_post_meta( $id, '_edit_lock' );
			$released = true;
		}
	}
	return rest_ensure_response(
		array(
			'id'       => $id,
			'released' => $released,
		)
	);
}
