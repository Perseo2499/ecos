<?php
/**
 * SEO completo desde Ecos (complemento 1.8.0): palabra clave, URL canónica, indexación y datos para redes sociales
 * de Yoast SEO y Rank Math. Estos metas no suelen estar en la API REST, así que Ecos los lee y escribe aquí:
 *
 *   GET  /ecos/v1/seo/<id>   → { plugin, premium, fields, writable }
 *   POST /ecos/v1/seo/<id>   { fields: { focusKw, canonical, noindex, ... } } → lo mismo, ya guardado
 *
 * Solo se tocan las claves de la lista blanca de abajo (nada más), con permiso para editar esa entrada.
 * La lista debe coincidir con renderer/app/seo-meta.js (la prueba test/seometa.test.js lo comprueba).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Plugin SEO activo con campos que Ecos sabe escribir: 'yoast', 'rankmath' o ''.
 */
function ecos_wp_seo2_plugin() {
	if ( defined( 'WPSEO_VERSION' ) || class_exists( 'WPSEO_Options' ) ) {
		return 'yoast';
	}
	if ( defined( 'RANK_MATH_VERSION' ) || class_exists( 'RankMath' ) ) {
		return 'rankmath';
	}
	return '';
}

function ecos_wp_seo2_premium() {
	return defined( 'WPSEO_PREMIUM_VERSION' ) || class_exists( 'WPSEO_Premium' );
}

/**
 * Lista blanca: campo de Ecos => meta de cada plugin.
 */
function ecos_wp_seo2_map( $plugin ) {
	$maps = array(
		'yoast'    => array(
			'focusKw'   => '_yoast_wpseo_focuskw',
			'extraKw'   => '_yoast_wpseo_focuskeywords',
			'canonical' => '_yoast_wpseo_canonical',
			'noindex'   => '_yoast_wpseo_meta-robots-noindex',
			'nofollow'  => '_yoast_wpseo_meta-robots-nofollow',
			'ogTitle'   => '_yoast_wpseo_opengraph-title',
			'ogDesc'    => '_yoast_wpseo_opengraph-description',
			'ogImage'   => '_yoast_wpseo_opengraph-image',
			'ogImageId' => '_yoast_wpseo_opengraph-image-id',
			'twTitle'   => '_yoast_wpseo_twitter-title',
			'twDesc'    => '_yoast_wpseo_twitter-description',
			'twImage'   => '_yoast_wpseo_twitter-image',
			'twImageId' => '_yoast_wpseo_twitter-image-id',
		),
		'rankmath' => array(
			'focusKw'   => 'rank_math_focus_keyword',
			'extraKw'   => 'rank_math_focus_keyword',
			'canonical' => 'rank_math_canonical_url',
			'noindex'   => 'rank_math_robots',
			'nofollow'  => 'rank_math_robots',
			'ogTitle'   => 'rank_math_facebook_title',
			'ogDesc'    => 'rank_math_facebook_description',
			'ogImage'   => 'rank_math_facebook_image',
			'ogImageId' => 'rank_math_facebook_image_id',
			'twTitle'   => 'rank_math_twitter_title',
			'twDesc'    => 'rank_math_twitter_description',
			'twImage'   => 'rank_math_twitter_image',
			'twImageId' => 'rank_math_twitter_image_id',
		),
	);
	return isset( $maps[ $plugin ] ) ? $maps[ $plugin ] : array();
}

function ecos_wp_seo2_kw_split( $s ) {
	$out = array();
	foreach ( explode( ',', (string) $s ) as $k ) {
		$k = trim( preg_replace( '/\s+/', ' ', $k ) );
		if ( '' !== $k ) {
			$out[] = $k;
		}
	}
	return $out;
}

/**
 * Metas del plugin → campos de Ecos.
 */
function ecos_wp_seo2_read( $id, $plugin ) {
	$map = ecos_wp_seo2_map( $plugin );
	$g   = function ( $k ) use ( $id, $map ) {
		return get_post_meta( $id, $map[ $k ], true );
	};
	$f   = array(
		'focusKw'   => '',
		'extraKw'   => array(),
		'canonical' => (string) $g( 'canonical' ),
		'noindex'   => false,
		'nofollow'  => false,
	);
	if ( 'rankmath' === $plugin ) {
		$kws          = ecos_wp_seo2_kw_split( $g( 'focusKw' ) );
		$f['focusKw'] = $kws ? $kws[0] : '';
		$f['extraKw'] = array_slice( $kws, 1 );
		$robots       = $g( 'noindex' );
		$robots       = is_array( $robots ) ? $robots : array();
		$f['noindex']  = in_array( 'noindex', $robots, true );
		$f['nofollow'] = in_array( 'nofollow', $robots, true );
	} else {
		$f['focusKw'] = (string) $g( 'focusKw' );
		$ex           = json_decode( (string) $g( 'extraKw' ), true );
		if ( is_array( $ex ) ) {
			foreach ( $ex as $x ) {
				if ( is_array( $x ) && ! empty( $x['keyword'] ) ) {
					$f['extraKw'][] = (string) $x['keyword'];
				}
			}
		}
		$f['noindex']  = '1' === (string) $g( 'noindex' );
		$f['nofollow'] = '1' === (string) $g( 'nofollow' );
	}
	foreach ( array( 'ogTitle', 'ogDesc', 'ogImage', 'twTitle', 'twDesc', 'twImage' ) as $k ) {
		$f[ $k ] = (string) $g( $k );
	}
	foreach ( array( 'ogImageId', 'twImageId' ) as $k ) {
		$f[ $k ] = (int) $g( $k );
	}
	return $f;
}

function ecos_wp_seo2_clean_url( $u ) {
	$u = trim( (string) $u );
	return '' === $u ? '' : esc_url_raw( $u, array( 'http', 'https' ) );
}

function ecos_wp_seo2_clean_text( $s, $max = 200 ) {
	return mb_substr( sanitize_text_field( (string) $s ), 0, $max );
}

/**
 * Escribe SOLO los campos permitidos que vengan en $in. Devuelve las claves de meta escritas.
 */
function ecos_wp_seo2_write( $id, $plugin, $in, $premium ) {
	$map = ecos_wp_seo2_map( $plugin );
	if ( ! $map || ! is_array( $in ) ) {
		return array();
	}
	$done = array();
	$put  = function ( $key, $value ) use ( $id, &$done ) {
		update_post_meta( $id, $key, $value );
		$done[] = $key;
	};
	$bool = function ( $v ) {
		return true === $v || 1 === $v || '1' === $v || 'true' === $v;
	};
	foreach ( array( 'canonical', 'ogImage', 'twImage' ) as $k ) {
		if ( array_key_exists( $k, $in ) ) {
			$put( $map[ $k ], ecos_wp_seo2_clean_url( $in[ $k ] ) );
		}
	}
	foreach ( array( 'ogTitle', 'twTitle' ) as $k ) {
		if ( array_key_exists( $k, $in ) ) {
			$put( $map[ $k ], ecos_wp_seo2_clean_text( $in[ $k ], 200 ) );
		}
	}
	foreach ( array( 'ogDesc', 'twDesc' ) as $k ) {
		if ( array_key_exists( $k, $in ) ) {
			$put( $map[ $k ], ecos_wp_seo2_clean_text( $in[ $k ], 400 ) );
		}
	}
	foreach ( array( 'ogImageId', 'twImageId' ) as $k ) {
		if ( array_key_exists( $k, $in ) ) {
			$put( $map[ $k ], (string) absint( $in[ $k ] ) );
		}
	}
	if ( 'rankmath' === $plugin ) {
		if ( array_key_exists( 'twTitle', $in ) || array_key_exists( 'twDesc', $in ) || array_key_exists( 'twImage', $in ) || array_key_exists( 'twImageId', $in ) ) {
			$put( 'rank_math_twitter_use_facebook', 'off' );
		}
		if ( array_key_exists( 'focusKw', $in ) || array_key_exists( 'extraKw', $in ) ) {
			$cur   = ecos_wp_seo2_read( $id, 'rankmath' );
			$main  = array_key_exists( 'focusKw', $in ) ? ecos_wp_seo2_clean_text( $in['focusKw'] ) : $cur['focusKw'];
			$extra = array_key_exists( 'extraKw', $in ) ? ( is_array( $in['extraKw'] ) ? $in['extraKw'] : ecos_wp_seo2_kw_split( $in['extraKw'] ) ) : $cur['extraKw'];
			$list  = array();
			foreach ( array_merge( array( $main ), $extra ) as $k ) {
				$k = ecos_wp_seo2_clean_text( $k );
				if ( '' !== $k && ! in_array( mb_strtolower( $k ), array_map( 'mb_strtolower', $list ), true ) ) {
					$list[] = $k;
				}
			}
			$put( $map['focusKw'], implode( ', ', array_slice( $list, 0, 11 ) ) );
		}
		if ( array_key_exists( 'noindex', $in ) || array_key_exists( 'nofollow', $in ) ) {
			$cur  = ecos_wp_seo2_read( $id, 'rankmath' );
			$old  = get_post_meta( $id, $map['noindex'], true );
			$keep = array();
			foreach ( is_array( $old ) ? $old : array() as $x ) {
				if ( is_string( $x ) && ! preg_match( '/^(no)?(index|follow)$/', $x ) ) {
					$keep[] = $x;
				}
			}
			$ni     = array_key_exists( 'noindex', $in ) ? $bool( $in['noindex'] ) : $cur['noindex'];
			$nf     = array_key_exists( 'nofollow', $in ) ? $bool( $in['nofollow'] ) : $cur['nofollow'];
			$robots = array_merge( array( $ni ? 'noindex' : 'index' ), $nf ? array( 'nofollow' ) : array(), $keep );
			$put( $map['noindex'], $robots );
		}
	} else {
		if ( array_key_exists( 'focusKw', $in ) ) {
			$put( $map['focusKw'], ecos_wp_seo2_clean_text( $in['focusKw'] ) );
		}
		if ( $premium && array_key_exists( 'extraKw', $in ) ) {
			$arr = array();
			foreach ( is_array( $in['extraKw'] ) ? $in['extraKw'] : ecos_wp_seo2_kw_split( $in['extraKw'] ) as $k ) {
				$k = ecos_wp_seo2_clean_text( $k );
				if ( '' !== $k ) {
					$arr[] = array(
						'keyword' => $k,
						'score'   => 'na',
					);
				}
			}
			$put( $map['extraKw'], wp_json_encode( array_slice( $arr, 0, 4 ) ) );
		}
		if ( array_key_exists( 'noindex', $in ) ) {
			$put( $map['noindex'], $bool( $in['noindex'] ) ? '1' : '0' );
		}
		if ( array_key_exists( 'nofollow', $in ) ) {
			$put( $map['nofollow'], $bool( $in['nofollow'] ) ? '1' : '0' );
		}
	}
	return $done;
}

/**
 * Yoast sirve lo que tiene en su tabla de indexables: se le pide reconstruirla para que la web pública
 * refleje el cambio enseguida (si falla, se recalcula sola al guardar la entrada).
 */
function ecos_wp_seo2_refresh( $id, $plugin ) {
	if ( 'yoast' !== $plugin || ! function_exists( 'YoastSEO' ) ) {
		return;
	}
	try {
		$builder = YoastSEO()->classes->get( 'Yoast\\WP\\SEO\\Builders\\Indexable_Builder' );
		$builder->build_for_id_and_type( $id, get_post_type( $id ) );
	} catch ( \Throwable $e ) {
		unset( $e );
	}
	clean_post_cache( $id );
}

function ecos_wp_seo2_response( $id ) {
	$plugin = ecos_wp_seo2_plugin();
	if ( '' === $plugin ) {
		return new WP_Error( 'ecos_no_seo', 'No hay Yoast SEO ni Rank Math activos.', array( 'status' => 404 ) );
	}
	$premium = 'yoast' === $plugin ? ecos_wp_seo2_premium() : true;
	return rest_ensure_response(
		array(
			'plugin'   => $plugin,
			'premium'  => $premium,
			'version'  => ECOS_WP_VERSION,
			'writable' => true,
			'fields'   => ecos_wp_seo2_read( $id, $plugin ),
		)
	);
}

function ecos_wp_rest_seo_get( $request ) {
	return ecos_wp_seo2_response( (int) $request['id'] );
}

function ecos_wp_rest_seo_post( $request ) {
	$id     = (int) $request['id'];
	$plugin = ecos_wp_seo2_plugin();
	if ( '' === $plugin ) {
		return new WP_Error( 'ecos_no_seo', 'No hay Yoast SEO ni Rank Math activos.', array( 'status' => 404 ) );
	}
	$body = $request->get_json_params();
	$in   = is_array( $body ) && isset( $body['fields'] ) && is_array( $body['fields'] ) ? $body['fields'] : array();
	ecos_wp_seo2_write( $id, $plugin, $in, 'yoast' === $plugin ? ecos_wp_seo2_premium() : true );
	ecos_wp_seo2_refresh( $id, $plugin );
	return ecos_wp_seo2_response( $id );
}

function ecos_wp_seo2_can_edit( $request ) {
	$id = (int) $request['id'];
	return $id > 0 && current_user_can( 'edit_post', $id );
}

function ecos_wp_register_seo2_routes() {
	register_rest_route(
		'ecos/v1',
		'/seo/(?P<id>\d+)',
		array(
			array(
				'methods'             => 'GET',
				'callback'            => 'ecos_wp_rest_seo_get',
				'permission_callback' => 'ecos_wp_seo2_can_edit',
			),
			array(
				'methods'             => 'POST',
				'callback'            => 'ecos_wp_rest_seo_post',
				'permission_callback' => 'ecos_wp_seo2_can_edit',
			),
		)
	);
}
add_action( 'rest_api_init', 'ecos_wp_register_seo2_routes' );
