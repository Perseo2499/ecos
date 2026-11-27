<?php
/**
 * Editor de WordPress dentro de Ecos (complemento 1.6.0).
 *
 * Ecos abre el editor oficial de WordPress (el de wp-admin) en una ventana propia para editar bloques de otros plugins
 * (Spectra, Kadence…) o la entrada completa. Para no pedir la contraseña cada vez, la ruta REST `ecos/v1/editor-session`
 * (con la contraseña de aplicación que ya usa Ecos) devuelve una dirección de UN SOLO USO, válida 60 segundos, que inicia
 * la sesión de esa persona y la lleva directamente al editor:
 *
 *   - el token son 32 bytes aleatorios; en la base de datos solo se guarda su hash (transient de 60 s),
 *   - va ligado a la persona y a la dirección de destino, que solo puede ser post.php o post-new.php de wp-admin de ESTA web,
 *   - al usarlo se borra (no vale dos veces) y la respuesta no se guarda en caché ni envía referer.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ECOS_WP_EDITOR_TTL', 60 );

/**
 * Normaliza y valida el destino. Devuelve la dirección completa dentro de wp-admin (post.php?post=N&action=edit o
 * post-new.php[?post_type=post|page]) o '' si no es válida. Función pura: recibe la base de wp-admin
 * (p. ej. https://web.com/wp-admin/) para poder probarse sin WordPress.
 */
function ecos_wp_editor_clean_target( $target, $admin_base ) {
	if ( ! is_string( $target ) || '' === $target || strlen( $target ) > 500 || preg_match( '/[\x00-\x20\\\\]/', $target ) ) {
		return '';
	}
	$base = parse_url( $admin_base );
	if ( empty( $base['host'] ) || empty( $base['path'] ) ) {
		return '';
	}
	$t = parse_url( $target );
	if ( false === $t ) {
		return '';
	}
	if ( isset( $t['host'] ) || isset( $t['scheme'] ) || isset( $t['user'] ) || isset( $t['pass'] ) || isset( $t['port'] ) ) {
		// Dirección completa: mismo servidor y esquema que wp-admin
		if ( empty( $t['host'] ) || empty( $t['scheme'] ) || strtolower( $t['host'] ) !== strtolower( $base['host'] ) || strtolower( $t['scheme'] ) !== strtolower( $base['scheme'] ) ) {
			return '';
		}
		if ( ( isset( $t['port'] ) ? $t['port'] : null ) !== ( isset( $base['port'] ) ? $base['port'] : null ) || isset( $t['user'] ) || isset( $t['pass'] ) ) {
			return '';
		}
		if ( 0 !== strpos( isset( $t['path'] ) ? $t['path'] : '', $base['path'] ) ) {
			return '';
		}
		$file = substr( $t['path'], strlen( $base['path'] ) );
	} else {
		$file = isset( $t['path'] ) ? ltrim( $t['path'], '/' ) : '';
		if ( 0 === strpos( '/' . $file, $base['path'] ) ) {
			$file = substr( '/' . $file, strlen( $base['path'] ) );
		}
	}
	if ( isset( $t['fragment'] ) && '' !== $t['fragment'] ) {
		return '';
	}
	$args = array();
	if ( ! empty( $t['query'] ) ) {
		parse_str( $t['query'], $args );
	}
	$root = rtrim( $admin_base, '/' ) . '/';
	if ( 'post.php' === $file ) {
		if ( ! isset( $args['post'] ) || ! ctype_digit( (string) $args['post'] ) || (int) $args['post'] < 1 || ( isset( $args['action'] ) && 'edit' !== $args['action'] ) ) {
			return '';
		}
		return $root . 'post.php?post=' . (int) $args['post'] . '&action=edit';
	}
	if ( 'post-new.php' === $file ) {
		$type = isset( $args['post_type'] ) ? $args['post_type'] : 'post';
		if ( ! in_array( $type, array( 'post', 'page' ), true ) ) {
			return '';
		}
		return $root . 'post-new.php' . ( 'post' === $type ? '' : '?post_type=page' );
	}
	return '';
}

function ecos_wp_editor_hash( $token ) {
	return hash( 'sha256', (string) $token );
}

/**
 * Crea la dirección de un solo uso. Devuelve array( 'token' => ..., ) o false si el destino no vale.
 */
function ecos_wp_editor_make_token( $user_id, $target ) {
	$clean = ecos_wp_editor_clean_target( $target, admin_url() );
	if ( '' === $clean || ! $user_id ) {
		return false;
	}
	$token = bin2hex( random_bytes( 32 ) );
	set_transient(
		'ecos_ed_' . ecos_wp_editor_hash( $token ),
		array(
			'user'   => (int) $user_id,
			'target' => $clean,
		),
		ECOS_WP_EDITOR_TTL
	);
	return $token;
}

/**
 * Consume el token: lo borra SIEMPRE (valga o no) y devuelve array( user, target ) o false.
 */
function ecos_wp_editor_consume_token( $token ) {
	if ( ! is_string( $token ) || ! preg_match( '/^[a-f0-9]{64}$/', $token ) ) {
		return false;
	}
	$key  = 'ecos_ed_' . ecos_wp_editor_hash( $token );
	$data = get_transient( $key );
	delete_transient( $key );
	if ( ! is_array( $data ) || empty( $data['user'] ) || empty( $data['target'] ) ) {
		return false;
	}
	// El destino se vuelve a comprobar por si el sitio cambió de dirección en estos 60 s.
	if ( '' === ecos_wp_editor_clean_target( $data['target'], admin_url() ) ) {
		return false;
	}
	return $data;
}

function ecos_wp_rest_editor_session( WP_REST_Request $request ) {
	$target = (string) $request->get_param( 'target' );
	$clean  = ecos_wp_editor_clean_target( $target, admin_url() );
	if ( '' === $clean ) {
		return new WP_Error( 'ecos_bad_target', 'Solo se puede abrir el editor de entradas o páginas de esta web.', array( 'status' => 400 ) );
	}
	if ( preg_match( '/post=(\d+)/', $clean, $m ) && ! current_user_can( 'edit_post', (int) $m[1] ) ) {
		return new WP_Error( 'ecos_forbidden', 'No tienes permiso para esa entrada.', array( 'status' => 403 ) );
	}
	$token = ecos_wp_editor_make_token( get_current_user_id(), $clean );
	if ( ! $token ) {
		return new WP_Error( 'ecos_bad_target', 'No se pudo preparar el editor.', array( 'status' => 400 ) );
	}
	return rest_ensure_response(
		array(
			'plugin'  => 'ecos',
			'url'     => add_query_arg(
				array(
					'action' => 'ecos_editor',
					't'      => $token,
				),
				admin_url( 'admin-post.php' )
			),
			'expires' => ECOS_WP_EDITOR_TTL,
		)
	);
}

function ecos_wp_register_editor_route() {
	register_rest_route(
		'ecos/v1',
		'/editor-session',
		array(
			'methods'             => 'POST',
			'callback'            => 'ecos_wp_rest_editor_session',
			'permission_callback' => 'ecos_wp_can_edit',
		)
	);
}
add_action( 'rest_api_init', 'ecos_wp_register_editor_route' );

/**
 * admin-post.php?action=ecos_editor&t=TOKEN: valida y borra el token, inicia sesión y redirige al editor.
 */
function ecos_wp_editor_landing() {
	nocache_headers();
	header( 'Referrer-Policy: no-referrer' );
	header( 'X-Robots-Tag: noindex, nofollow' );
	$token = isset( $_GET['t'] ) ? sanitize_text_field( wp_unslash( $_GET['t'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
	$data  = ecos_wp_editor_consume_token( $token );
	$user  = $data ? get_userdata( (int) $data['user'] ) : false;
	if ( ! $data || ! $user || ! user_can( $user, 'edit_posts' ) ) {
		wp_die( esc_html( 'Este enlace del editor ya se usó o ha caducado. Vuelve a Ecos y pulsa de nuevo «Editar en WordPress».' ), 'Ecos', array( 'response' => 403 ) );
	}
	wp_set_current_user( $user->ID );
	wp_set_auth_cookie( $user->ID, true );
	wp_safe_redirect( $data['target'] );
	exit;
}
add_action( 'admin_post_nopriv_ecos_editor', 'ecos_wp_editor_landing' );
add_action( 'admin_post_ecos_editor', 'ecos_wp_editor_landing' );
