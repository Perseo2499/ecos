<?php
/**
 * Ecos para WordPress · exportación de la configuración para la «Copia de emergencia» de Ecos.
 * GET /wp-json/ecos/v1/export (solo con permiso manage_options): ajustes del personalizador del tema activo,
 * CSS adicional, widgets, opciones de Astra y Spectra, plugins y temas con su versión, versión de WordPress y PHP.
 * Nunca se exportan contraseñas, claves ni licencias: se descarta todo nombre (de opción o de clave) que las sugiera.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Patrón de los nombres que NO se exportan (insensible a mayúsculas). Ecos tiene la misma lista en src/emergency.js.
 */
define( 'ECOS_WP_SENSITIVE_RE', '/key|secret|token|password|pass|license/i' );

function ecos_wp_sensitive_name( $name ) {
	return (bool) preg_match( ECOS_WP_SENSITIVE_RE, (string) $name );
}

/**
 * Quita, a cualquier profundidad, las claves de matriz u objeto con nombre sensible.
 */
function ecos_wp_scrub( $value, $depth = 0 ) {
	if ( $depth > 12 ) {
		return null;
	}
	if ( is_object( $value ) ) {
		$value = get_object_vars( $value );
	}
	if ( ! is_array( $value ) ) {
		return $value;
	}
	$out = array();
	foreach ( $value as $k => $v ) {
		if ( is_string( $k ) && ecos_wp_sensitive_name( $k ) ) {
			continue;
		}
		$out[ $k ] = ecos_wp_scrub( $v, $depth + 1 );
	}
	return $out;
}

/**
 * Opciones de Astra y Spectra (por prefijo), sin las sensibles ni las demasiado grandes.
 */
function ecos_wp_export_options() {
	global $wpdb;
	$like = array( 'astra%', 'ast-%', 'ast\_%', 'uag\_%', 'spectra\_%', 'spectra-%' );
	$sql  = array();
	foreach ( $like as $l ) {
		$sql[] = $wpdb->prepare( 'option_name LIKE %s', $l ); // phpcs:ignore WordPress.DB
	}
	$names = $wpdb->get_col( "SELECT option_name FROM {$wpdb->options} WHERE " . implode( ' OR ', $sql ) . ' ORDER BY option_name LIMIT 500' ); // phpcs:ignore WordPress.DB
	$out   = array();
	foreach ( (array) $names as $name ) {
		if ( ecos_wp_sensitive_name( $name ) || 0 === strpos( $name, '_transient' ) ) {
			continue;
		}
		$value = ecos_wp_scrub( get_option( $name ) );
		if ( strlen( wp_json_encode( $value ) ) > 1000000 ) {
			$value = '(demasiado grande para incluirla)';
		}
		$out[ $name ] = $value;
	}
	return $out;
}

function ecos_wp_export_plugins() {
	if ( ! function_exists( 'get_plugins' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}
	$out = array();
	foreach ( get_plugins() as $file => $p ) {
		$out[] = array(
			'file'           => $file,
			'name'           => $p['Name'],
			'version'        => $p['Version'],
			'uri'            => $p['PluginURI'],
			'active'         => is_plugin_active( $file ),
			'network_active' => is_multisite() && is_plugin_active_for_network( $file ),
		);
	}
	return $out;
}

function ecos_wp_export_themes() {
	$active = get_stylesheet();
	$out    = array();
	foreach ( wp_get_themes() as $slug => $t ) {
		$out[] = array(
			'stylesheet' => $slug,
			'name'       => $t->get( 'Name' ),
			'version'    => $t->get( 'Version' ),
			'parent'     => $t->parent() ? $t->parent()->get_stylesheet() : '',
			'active'     => $slug === $active,
		);
	}
	return $out;
}

function ecos_wp_export_widgets() {
	global $wpdb;
	$bases = $wpdb->get_col( "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE 'widget\\_%' ORDER BY option_name LIMIT 200" ); // phpcs:ignore WordPress.DB
	$out   = array(
		'sidebars_widgets' => ecos_wp_scrub( wp_get_sidebars_widgets() ),
		'widgets'          => array(),
	);
	foreach ( (array) $bases as $name ) {
		if ( ecos_wp_sensitive_name( $name ) ) {
			continue;
		}
		$out['widgets'][ $name ] = ecos_wp_scrub( get_option( $name ) );
	}
	return $out;
}

function ecos_wp_rest_export() {
	global $wp_version;
	$stylesheet = get_stylesheet();
	$template   = get_template();
	$mods       = get_theme_mods();
	$parent     = $template !== $stylesheet ? get_option( 'theme_mods_' . $template ) : null;
	$theme      = wp_get_theme();
	return rest_ensure_response(
		array(
			'plugin'            => 'ecos',
			'version'           => ECOS_WP_VERSION,
			'created'           => gmdate( 'c' ),
			'site'              => array(
				'name'           => get_bloginfo( 'name' ),
				'description'    => get_bloginfo( 'description' ),
				'url'            => home_url( '/' ),
				'wp_url'         => site_url( '/' ),
				'language'       => get_locale(),
				'timezone'       => wp_timezone_string(),
				'multisite'      => is_multisite(),
				'wordpress'      => $wp_version,
				'php'            => PHP_VERSION,
				'permalinks'     => get_option( 'permalink_structure' ),
				'category_base'  => get_option( 'category_base' ),
				'tag_base'       => get_option( 'tag_base' ),
				'show_on_front'  => get_option( 'show_on_front' ),
				'page_on_front'  => (int) get_option( 'page_on_front' ),
				'page_for_posts' => (int) get_option( 'page_for_posts' ),
			),
			'theme'             => array(
				'stylesheet' => $stylesheet,
				'template'   => $template,
				'name'       => $theme->get( 'Name' ),
				'version'    => $theme->get( 'Version' ),
			),
			'theme_mods'        => ecos_wp_scrub( $mods ),
			'parent_theme_mods' => ( null === $parent || false === $parent ) ? null : ecos_wp_scrub( $parent ),
			'custom_css'        => wp_get_custom_css(),
			'widgets'           => ecos_wp_export_widgets(),
			'options'           => ecos_wp_export_options(),
			'plugins'           => ecos_wp_export_plugins(),
			'themes'            => ecos_wp_export_themes(),
		)
	);
}

function ecos_wp_register_export_route() {
	register_rest_route(
		'ecos/v1',
		'/export',
		array(
			'methods'             => 'GET',
			'callback'            => 'ecos_wp_rest_export',
			'permission_callback' => function () {
				return current_user_can( 'manage_options' );
			},
		)
	);
}
add_action( 'rest_api_init', 'ecos_wp_register_export_route' );
