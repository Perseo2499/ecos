<?php
/**
 * Ecos para WordPress · estilos de la web (1.4.0).
 * GET /wp-json/ecos/v1/theme (permiso edit_posts): paleta de colores, degradados, tamaños de letra y familias tipográficas
 * del tema activo (wp_get_global_settings) y, con Astra, la paleta global y las fuentes del texto y de los títulos.
 * También registra las metas de «Diseño de la página» de Astra para que Ecos las lea y las guarde por la API REST.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * ¿El tema activo es Astra (o un tema hijo de Astra)?
 */
function ecos_wp_is_astra() {
	return 'astra' === get_template() || defined( 'ASTRA_THEME_VERSION' );
}

/**
 * Lista de ajustes por origen: WordPress devuelve { theme: [], default: [], custom: [] } o directamente la lista.
 */
function ecos_wp_pick_origin( $value ) {
	if ( ! is_array( $value ) || ! $value ) {
		return array();
	}
	if ( array_keys( $value ) === range( 0, count( $value ) - 1 ) ) {
		return array( 'theme' => $value );
	}
	$out = array();
	foreach ( array( 'theme', 'custom', 'default' ) as $origin ) {
		if ( ! empty( $value[ $origin ] ) && is_array( $value[ $origin ] ) ) {
			$out[ $origin ] = $value[ $origin ];
		}
	}
	return $out;
}

/**
 * Ajustes globales del tema que le interesan a Ecos, con el origen de cada elemento.
 */
function ecos_wp_theme_settings() {
	$settings = function_exists( 'wp_get_global_settings' ) ? wp_get_global_settings() : array();
	$get      = function ( $path ) use ( $settings ) {
		$cur = $settings;
		foreach ( $path as $key ) {
			if ( ! is_array( $cur ) || ! isset( $cur[ $key ] ) ) {
				return array();
			}
			$cur = $cur[ $key ];
		}
		return ecos_wp_pick_origin( $cur );
	};
	return array(
		'color'      => array(
			'palette'   => $get( array( 'color', 'palette' ) ),
			'gradients' => $get( array( 'color', 'gradients' ) ),
		),
		'typography' => array(
			'fontSizes'    => $get( array( 'typography', 'fontSizes' ) ),
			'fontFamilies' => $get( array( 'typography', 'fontFamilies' ) ),
		),
	);
}

/**
 * Ajustes de Astra: paleta global (astra-settings → global-color-palette) y fuentes del texto y de los títulos.
 */
function ecos_wp_astra_settings() {
	if ( ! ecos_wp_is_astra() ) {
		return null;
	}
	$opts    = get_option( 'astra-settings', array() );
	$opts    = is_array( $opts ) ? $opts : array();
	$palette = array();
	if ( isset( $opts['global-color-palette']['palette'] ) && is_array( $opts['global-color-palette']['palette'] ) ) {
		foreach ( array_values( $opts['global-color-palette']['palette'] ) as $i => $c ) {
			if ( is_string( $c ) && '' !== $c ) {
				$palette[] = array(
					'slug'  => 'ast-global-color-' . $i,
					'name'  => sprintf( 'Color %d', $i + 1 ),
					'color' => $c,
				);
			}
		}
	}
	$font = function ( $key ) use ( $opts ) {
		$v = isset( $opts[ $key ] ) && is_string( $opts[ $key ] ) ? trim( $opts[ $key ] ) : '';
		return '' === $v ? 'inherit' : $v;
	};
	return array(
		'palette'     => $palette,
		'bodyFont'    => $font( 'body-font-family' ),
		'headingFont' => $font( 'headings-font-family' ),
	);
}

function ecos_wp_rest_theme() {
	$theme = wp_get_theme();
	return rest_ensure_response(
		array(
			'plugin'   => 'ecos',
			'version'  => ECOS_WP_VERSION,
			'theme'    => array(
				'name'       => $theme->get( 'Name' ),
				'stylesheet' => get_stylesheet(),
				'template'   => get_template(),
				'isAstra'    => ecos_wp_is_astra(),
				'isBlock'    => function_exists( 'wp_is_block_theme' ) && wp_is_block_theme(),
			),
			'settings' => ecos_wp_theme_settings(),
			'astra'    => ecos_wp_astra_settings(),
		)
	);
}

function ecos_wp_register_theme_route() {
	register_rest_route(
		'ecos/v1',
		'/theme',
		array(
			'methods'             => 'GET',
			'callback'            => 'ecos_wp_rest_theme',
			'permission_callback' => 'ecos_wp_can_edit',
		)
	);
}
add_action( 'rest_api_init', 'ecos_wp_register_theme_route' );

/**
 * Metas de «Diseño de la página» de Astra (por entrada o página): nombre → valores que acepta Astra.
 * Los valores que no están en la lista se guardan vacíos (= el predeterminado de Astra).
 */
function ecos_wp_astra_metas() {
	return array(
		// Diseño del contenedor: el nuevo (Astra 3.9+) y el antiguo.
		'ast-site-content-layout'       => array( 'default', 'normal-width-container', 'narrow-width-container', 'full-width-container' ),
		'site-content-layout'           => array( 'default', 'boxed-container', 'content-boxed-container', 'plain-container', 'page-builder' ),
		'site-content-style'            => array( 'default', 'unboxed', 'boxed' ),
		'site-sidebar-layout'           => array( 'default', 'no-sidebar', 'left-sidebar', 'right-sidebar' ),
		'site-post-title'               => array( '', 'disabled' ),
		'ast-featured-img'              => array( '', 'disabled' ),
		'ast-main-header-display'       => array( '', 'disabled' ),
		'ast-global-header-display'     => array( '', 'disabled' ),
		'footer-sml-layout'             => array( '', 'disabled' ),
		'footer-adv-display'            => array( '', 'disabled' ),
		'theme-transparent-header-meta' => array( 'default', 'enabled', 'disabled' ),
	);
}

function ecos_wp_register_astra_metas() {
	foreach ( array( 'post', 'page' ) as $type ) {
		foreach ( ecos_wp_astra_metas() as $key => $allowed ) {
			register_post_meta(
				$type,
				$key,
				array(
					'single'            => true,
					'type'              => 'string',
					'show_in_rest'      => true,
					'sanitize_callback' => function ( $value ) use ( $allowed ) {
						$value = is_string( $value ) ? $value : '';
						return in_array( $value, $allowed, true ) ? $value : '';
					},
					'auth_callback'     => function ( $allowed_cap, $meta_key, $post_id ) {
						return current_user_can( 'edit_post', $post_id );
					},
				)
			);
		}
	}
}
add_action( 'init', 'ecos_wp_register_astra_metas' );
