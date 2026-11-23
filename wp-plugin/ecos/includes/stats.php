<?php
/**
 * Ecos para WordPress · visitas sin cookies.
 * Solo se guardan contadores por entrada y día ({prefix}ecos_views): ni IP, ni user-agent, ni cookies.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ECOS_WP_DB_VERSION', '1' );

function ecos_wp_views_table() {
	global $wpdb;
	return $wpdb->prefix . 'ecos_views';
}

function ecos_wp_install() {
	global $wpdb;
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	$table   = ecos_wp_views_table();
	$charset = $wpdb->get_charset_collate();
	dbDelta(
		"CREATE TABLE {$table} (
  post_id bigint(20) unsigned NOT NULL,
  day date NOT NULL,
  views int(10) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY  (post_id,day),
  KEY day (day)
) {$charset};"
	);
	update_option( 'ecos_wp_db', ECOS_WP_DB_VERSION );
}
register_activation_hook( ECOS_WP_DIR . 'ecos.php', 'ecos_wp_install' );

// Si el complemento se actualiza subiendo el .zip, la activación no se repite: se crea la tabla al primer uso.
function ecos_wp_maybe_install() {
	if ( get_option( 'ecos_wp_db' ) !== ECOS_WP_DB_VERSION ) {
		ecos_wp_install();
	}
}
add_action( 'init', 'ecos_wp_maybe_install' );

/**
 * ¿Este user-agent es un robot, una vista previa o una herramienta?
 */
function ecos_wp_is_bot( $ua ) {
	$ua = strtolower( (string) $ua );
	if ( strlen( $ua ) < 12 ) {
		return true;
	}
	return (bool) preg_match( '/bot|crawl|spider|slurp|preview|fetch|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl|wget|python|java\/|go-http|php\/|node-fetch|axios|scrapy|httpclient|facebookexternalhit|whatsapp|telegram|discord|skype|embedly|validator/', $ua );
}

/**
 * Script de visitas: solo en entradas y páginas sueltas, y no para quien puede editar.
 */
function ecos_wp_enqueue_hit() {
	if ( ! is_singular() || is_preview() || is_customize_preview() ) {
		return;
	}
	if ( is_user_logged_in() && current_user_can( 'edit_posts' ) ) {
		return;
	}
	$post = get_queried_object();
	if ( ! ( $post instanceof WP_Post ) || 'publish' !== $post->post_status || ! empty( $post->post_password ) ) {
		return;
	}
	wp_enqueue_script(
		'ecos-hit',
		ECOS_WP_URL . 'assets/ecos-hit.js',
		array(),
		ECOS_WP_VERSION,
		array(
			'in_footer' => true,
			'strategy'  => 'defer',
		)
	);
	wp_add_inline_script(
		'ecos-hit',
		'window.ecosHit=' . wp_json_encode(
			array(
				'url' => esc_url_raw( rest_url( 'ecos/v1/hit' ) ),
				'id'  => (int) $post->ID,
			)
		) . ';',
		'before'
	);
}
add_action( 'wp_enqueue_scripts', 'ecos_wp_enqueue_hit' );

/**
 * Límite de tasa sencillo: solo se guarda un hash de la IP (con la sal del sitio) dentro de un transient.
 * Máximo $max avisos por clave en $window segundos.
 */
function ecos_wp_rate_ok( $key, $max, $window ) {
	$ip = apply_filters( 'ecos_wp_client_ip', isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '' );
	$k  = 'ecos_rl_' . substr( hash_hmac( 'sha256', $ip . '|' . $key, wp_salt() ), 0, 32 );
	$n  = (int) get_transient( $k );
	if ( $n >= $max ) {
		return false;
	}
	set_transient( $k, $n + 1, $window );
	return true;
}

function ecos_wp_rest_hit( WP_REST_Request $request ) {
	$none = rest_ensure_response( array( 'counted' => false ) );
	$id   = absint( $request->get_param( 'id' ) );
	$ua   = isset( $_SERVER['HTTP_USER_AGENT'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ) : '';
	if ( ! $id || ecos_wp_is_bot( $ua ) ) {
		return $none;
	}
	$purpose = strtolower( ( isset( $_SERVER['HTTP_SEC_PURPOSE'] ) ? $_SERVER['HTTP_SEC_PURPOSE'] : '' ) . ( isset( $_SERVER['HTTP_PURPOSE'] ) ? $_SERVER['HTTP_PURPOSE'] : '' ) ); // phpcs:ignore
	if ( false !== strpos( $purpose, 'prefetch' ) || false !== strpos( $purpose, 'prerender' ) ) {
		return $none;
	}
	if ( is_user_logged_in() && current_user_can( 'edit_posts' ) ) {
		return $none;
	}
	$post = get_post( $id );
	if ( ! $post || 'publish' !== $post->post_status || ! empty( $post->post_password ) ) {
		return $none;
	}
	$type = get_post_type_object( $post->post_type );
	if ( ! $type || ! $type->public ) {
		return $none;
	}
	// Por IP (solo su hash): 5 por entrada cada 30 min (varias personas pueden compartir conexión) y 120 en total cada 10 min.
	if ( ! ecos_wp_rate_ok( 'p' . $id, 5, 30 * MINUTE_IN_SECONDS ) || ! ecos_wp_rate_ok( 'all', 120, 10 * MINUTE_IN_SECONDS ) ) {
		return $none;
	}
	global $wpdb;
	$table = ecos_wp_views_table();
	$day   = current_time( 'Y-m-d' );
	$wpdb->query( $wpdb->prepare( "INSERT INTO {$table} (post_id, day, views) VALUES (%d, %s, 1) ON DUPLICATE KEY UPDATE views = views + 1", $id, $day ) ); // phpcs:ignore WordPress.DB.PreparedSQL
	return rest_ensure_response( array( 'counted' => true ) );
}

/**
 * Totales por día y entradas más leídas del periodo.
 */
function ecos_wp_stats( $days, $limit = 5 ) {
	global $wpdb;
	$table = ecos_wp_views_table();
	$days  = max( 1, min( 365, (int) $days ) );
	$limit = max( 1, min( 20, (int) $limit ) );
	$today = new DateTimeImmutable( 'today', wp_timezone() );
	$from  = $today->modify( '-' . ( $days - 1 ) . ' days' )->format( 'Y-m-d' );

	$rows = $wpdb->get_results( $wpdb->prepare( "SELECT day, SUM(views) AS v FROM {$table} WHERE day >= %s GROUP BY day", $from ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL
	$by   = array();
	foreach ( (array) $rows as $r ) {
		$by[ $r['day'] ] = (int) $r['v'];
	}
	$daily = array();
	$total = 0;
	for ( $i = $days - 1; $i >= 0; $i-- ) {
		$d       = $today->modify( '-' . $i . ' days' )->format( 'Y-m-d' );
		$v       = isset( $by[ $d ] ) ? $by[ $d ] : 0;
		$total  += $v;
		$daily[] = array(
			'day'   => $d,
			'views' => $v,
		);
	}

	$tops = $wpdb->get_results( $wpdb->prepare( "SELECT post_id, SUM(views) AS v FROM {$table} WHERE day >= %s GROUP BY post_id ORDER BY v DESC LIMIT %d", $from, $limit + 10 ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL
	$top  = array();
	foreach ( (array) $tops as $r ) {
		$p = get_post( (int) $r['post_id'] );
		if ( ! $p || 'publish' !== $p->post_status ) {
			continue;
		}
		$top[] = array(
			'id'    => (int) $p->ID,
			'title' => wp_strip_all_tags( get_the_title( $p ) ),
			'link'  => get_permalink( $p ),
			'views' => (int) $r['v'],
		);
		if ( count( $top ) >= $limit ) {
			break;
		}
	}
	return array(
		'days'  => $days,
		'from'  => $from,
		'to'    => $today->format( 'Y-m-d' ),
		'total' => $total,
		'daily' => $daily,
		'top'   => $top,
	);
}

function ecos_wp_rest_stats( WP_REST_Request $request ) {
	$days  = $request->get_param( 'days' );
	$limit = $request->get_param( 'limit' );
	return rest_ensure_response( ecos_wp_stats( $days ? $days : 30, $limit ? $limit : 5 ) );
}

function ecos_wp_can_manage() {
	return current_user_can( 'manage_options' );
}

function ecos_wp_rest_settings_get() {
	return rest_ensure_response( ecos_wp_get_settings() );
}

function ecos_wp_rest_settings_post( WP_REST_Request $request ) {
	$body = $request->get_json_params();
	if ( ! is_array( $body ) ) {
		$body = $request->get_params();
	}
	$clean = ecos_wp_sanitize_settings( $body );
	update_option( 'ecos_wp_settings', $clean, false );
	return rest_ensure_response(
		array(
			'saved'    => true,
			'settings' => $clean,
		)
	);
}

function ecos_wp_register_stats_routes() {
	register_rest_route(
		'ecos/v1',
		'/hit',
		array(
			'methods'             => 'POST',
			'callback'            => 'ecos_wp_rest_hit',
			'permission_callback' => '__return_true',
		)
	);
	register_rest_route(
		'ecos/v1',
		'/stats',
		array(
			'methods'             => 'GET',
			'callback'            => 'ecos_wp_rest_stats',
			'permission_callback' => 'ecos_wp_can_edit',
		)
	);
	register_rest_route(
		'ecos/v1',
		'/settings',
		array(
			array(
				'methods'             => 'GET',
				'callback'            => 'ecos_wp_rest_settings_get',
				'permission_callback' => 'ecos_wp_can_manage',
			),
			array(
				'methods'             => 'POST',
				'callback'            => 'ecos_wp_rest_settings_post',
				'permission_callback' => 'ecos_wp_can_manage',
			),
		)
	);
}
add_action( 'rest_api_init', 'ecos_wp_register_stats_routes' );
