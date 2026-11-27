<?php
/**
 * Ecos para WordPress · idiomas con Polylang o WPML (1.8.0).
 *
 * GET  /wp-json/ecos/v1/lang                  → { plugin: polylang|wpml|null, languages:[{code,name,locale,flag,default}] }
 * GET  /wp-json/ecos/v1/lang?post=12          → … + { lang, translations:{ código: id } } de esa entrada
 * GET  /wp-json/ecos/v1/lang?ids=1,2,3        → … + { langs:{ id: código } } (para la lista del Blog)
 * POST /wp-json/ecos/v1/lang { post, lang, translation_of? }
 *      → pone el idioma a la entrada y, con translation_of, la enlaza como traducción de esa otra.
 * Permiso: edit_posts (y edit_post de cada entrada que se toca).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function ecos_wp_lang_plugin() {
	if ( function_exists( 'pll_languages_list' ) && function_exists( 'pll_get_post_language' ) ) {
		return 'polylang';
	}
	if ( defined( 'ICL_SITEPRESS_VERSION' ) && has_filter( 'wpml_active_languages' ) ) {
		return 'wpml';
	}
	return null;
}

function ecos_wp_lang_list( $plugin ) {
	$out = array();
	if ( 'polylang' === $plugin ) {
		$default = function_exists( 'pll_default_language' ) ? pll_default_language() : '';
		$rows    = pll_languages_list( array( 'fields' => '' ) );
		foreach ( (array) $rows as $l ) {
			$out[] = array(
				'code'    => $l->slug,
				'name'    => $l->name,
				'locale'  => $l->locale,
				'flag'    => isset( $l->flag_url ) ? $l->flag_url : '',
				'default' => $l->slug === $default,
			);
		}
	} elseif ( 'wpml' === $plugin ) {
		$default = apply_filters( 'wpml_default_language', null );
		$rows    = apply_filters( 'wpml_active_languages', null, array( 'skip_missing' => 0 ) );
		foreach ( (array) $rows as $code => $l ) {
			$out[] = array(
				'code'    => $code,
				'name'    => isset( $l['native_name'] ) ? $l['native_name'] : $code,
				'locale'  => isset( $l['default_locale'] ) ? $l['default_locale'] : '',
				'flag'    => isset( $l['country_flag_url'] ) ? $l['country_flag_url'] : '',
				'default' => $code === $default,
			);
		}
	}
	return $out;
}

function ecos_wp_lang_of( $plugin, $id ) {
	if ( 'polylang' === $plugin ) {
		$l = pll_get_post_language( $id );
		return $l ? $l : '';
	}
	$d = apply_filters( 'wpml_post_language_details', null, $id );
	return is_array( $d ) && isset( $d['language_code'] ) ? $d['language_code'] : '';
}

function ecos_wp_lang_translations( $plugin, $id ) {
	$out = array();
	if ( 'polylang' === $plugin ) {
		foreach ( (array) pll_get_post_translations( $id ) as $code => $tid ) {
			$out[ $code ] = (int) $tid;
		}
	} elseif ( 'wpml' === $plugin ) {
		$type = 'post_' . get_post_type( $id );
		$trid = apply_filters( 'wpml_element_trid', null, $id, $type );
		if ( $trid ) {
			foreach ( (array) apply_filters( 'wpml_get_element_translations', null, $trid, $type ) as $code => $row ) {
				$out[ $code ] = (int) $row->element_id;
			}
		}
	}
	return $out;
}

function ecos_wp_rest_lang_get( $request ) {
	$plugin = ecos_wp_lang_plugin();
	$res    = array(
		'plugin'    => $plugin,
		'version'   => ECOS_WP_VERSION,
		'languages' => $plugin ? ecos_wp_lang_list( $plugin ) : array(),
	);
	if ( ! $plugin ) {
		return rest_ensure_response( $res );
	}
	$post = absint( $request->get_param( 'post' ) );
	if ( $post ) {
		if ( ! current_user_can( 'edit_post', $post ) ) {
			return new WP_Error( 'ecos_forbidden', 'No tienes permiso para editar esta entrada.', array( 'status' => 403 ) );
		}
		$res['lang']         = ecos_wp_lang_of( $plugin, $post );
		$res['translations'] = (object) ecos_wp_lang_translations( $plugin, $post );
	}
	$ids = (string) $request->get_param( 'ids' );
	if ( '' !== $ids ) {
		$langs = array();
		foreach ( array_slice( array_filter( array_map( 'absint', explode( ',', $ids ) ) ), 0, 200 ) as $id ) {
			if ( current_user_can( 'edit_post', $id ) ) {
				$langs[ $id ] = ecos_wp_lang_of( $plugin, $id );
			}
		}
		$res['langs'] = (object) $langs;
	}
	return rest_ensure_response( $res );
}

function ecos_wp_rest_lang_set( $request ) {
	$plugin = ecos_wp_lang_plugin();
	if ( ! $plugin ) {
		return new WP_Error( 'ecos_no_lang', 'Esta web no tiene Polylang ni WPML activo.', array( 'status' => 400 ) );
	}
	$post = absint( $request->get_param( 'post' ) );
	$lang = sanitize_key( (string) $request->get_param( 'lang' ) );
	$orig = absint( $request->get_param( 'translation_of' ) );
	if ( ! $post || '' === $lang || ! current_user_can( 'edit_post', $post ) || ( $orig && ! current_user_can( 'edit_post', $orig ) ) ) {
		return new WP_Error( 'ecos_forbidden', 'No tienes permiso para editar esta entrada.', array( 'status' => 403 ) );
	}
	if ( 'polylang' === $plugin ) {
		pll_set_post_language( $post, $lang );
		if ( $orig ) {
			$tr          = pll_get_post_translations( $orig );
			$tr[ $lang ] = $post;
			pll_save_post_translations( $tr );
		}
	} else {
		$args = array(
			'element_id'    => $post,
			'element_type'  => 'post_' . get_post_type( $post ),
			'language_code' => $lang,
		);
		if ( $orig ) {
			$trid = apply_filters( 'wpml_element_trid', null, $orig, 'post_' . get_post_type( $orig ) );
			$src  = ecos_wp_lang_of( 'wpml', $orig );
			if ( $trid ) {
				$args['trid']                 = $trid;
				$args['source_language_code'] = $src ? $src : null;
			}
		}
		do_action( 'wpml_set_element_language_details', $args );
	}
	return rest_ensure_response(
		array(
			'plugin'       => 'ecos',
			'lang'         => ecos_wp_lang_of( $plugin, $post ),
			'translations' => (object) ecos_wp_lang_translations( $plugin, $post ),
		)
	);
}

function ecos_wp_register_lang_routes() {
	register_rest_route(
		'ecos/v1',
		'/lang',
		array(
			array(
				'methods'             => 'GET',
				'callback'            => 'ecos_wp_rest_lang_get',
				'permission_callback' => 'ecos_wp_can_edit',
			),
			array(
				'methods'             => 'POST',
				'callback'            => 'ecos_wp_rest_lang_set',
				'permission_callback' => 'ecos_wp_can_edit',
			),
		)
	);
}
add_action( 'rest_api_init', 'ecos_wp_register_lang_routes' );
