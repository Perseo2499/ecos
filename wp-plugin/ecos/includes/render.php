<?php
/**
 * Ecos para WordPress · vista previa exacta (1.4.0).
 * POST /wp-json/ecos/v1/render { id?, content, title, type, excerpt?, meta?, featured_media? } (permiso edit_posts)
 * Devuelve el HTML de una página completa pintada con el tema real (cabecera, menú, pie y estilos) con ese contenido,
 * SIN guardarlo: la entrada se construye solo en memoria (no se crea ninguna fila en la base de datos), se ejecuta la
 * plantilla del tema con ella y después se devuelve todo a su estado. No queda nada que borrar.
 * Los scripts se quitan (salvo los de este complemento): la vista previa se muestra en un iframe aislado.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function ecos_wp_render_post( $id, $type, $title, $content, $excerpt ) {
	$fake_id = $id ? $id : 2147480000;
	$base    = $id ? get_post( $id ) : null;
	$data    = $base ? get_object_vars( $base ) : array(
		'ID'             => $fake_id,
		'post_author'    => get_current_user_id(),
		'post_date'      => current_time( 'mysql' ),
		'post_date_gmt'  => current_time( 'mysql', true ),
		'post_modified'  => current_time( 'mysql' ),
		'comment_status' => 'closed',
		'ping_status'    => 'closed',
		'post_name'      => 'vista-previa-ecos',
		'post_parent'    => 0,
		'menu_order'     => 0,
		'comment_count'  => 0,
	);
	$data['post_type']    = $type;
	$data['post_status']  = 'publish'; // solo en memoria: así el tema la pinta como una entrada normal
	$data['post_title']   = $title;
	$data['post_content'] = $content;
	$data['post_excerpt'] = $excerpt;
	$data['filter']       = 'raw';
	return new WP_Post( (object) $data );
}

/**
 * Pinta la plantilla del tema con la entrada en memoria y devuelve el HTML.
 */
function ecos_wp_render_page( $post, $type, $meta ) {
	global $wp_query, $wp_the_query, $wp_actions;
	$saved = array(
		'query' => $wp_query,
		'the'   => $wp_the_query,
		'post'  => isset( $GLOBALS['post'] ) ? $GLOBALS['post'] : null,
	);
	$id    = $post->ID;
	$old   = wp_cache_get( $id, 'posts' );

	// Metas de la vista previa (ajustes de Astra, imagen destacada) sin tocar la base de datos.
	$meta_filter_wrapped = function ( $value, $object_id, $meta_key, $single ) use ( $id, $meta ) {
		if ( (int) $object_id === (int) $id && is_string( $meta_key ) && array_key_exists( $meta_key, $meta ) ) {
			return array( $meta[ $meta_key ] );
		}
		return $value;
	};

	add_filter( 'get_post_metadata', $meta_filter_wrapped, 10, 4 );
	add_filter( 'show_admin_bar', '__return_false', 99 );
	wp_cache_set( $id, $post, 'posts' );

	$q                    = new WP_Query();
	$q->posts             = array( $post );
	$q->post              = $post;
	$q->post_count        = 1;
	$q->found_posts       = 1;
	$q->max_num_pages     = 1;
	$q->queried_object    = $post;
	$q->queried_object_id = $id;
	$q->is_singular       = true;
	$q->is_single         = 'post' === $type;
	$q->is_page           = 'page' === $type;
	$q->is_home           = false;
	$q->is_404            = false;
	$q->query_vars        = array_merge( $q->query_vars, array( 'p' => $id ) );
	$wp_query             = $q;
	$wp_the_query         = $q;
	$GLOBALS['post']      = $post;
	setup_postdata( $post );

	$html = '';
	try {
		$template = 'page' === $type ? get_page_template() : get_single_template();
		if ( ! $template ) {
			$template = get_index_template();
		}
		$template = apply_filters( 'template_include', $template );
		$level = ob_get_level();
		ob_start();
		if ( $template && is_readable( $template ) ) {
			include $template;
		}
		$html = ob_get_clean();
	} finally {
		while ( isset( $level ) && ob_get_level() > $level ) {
			ob_end_clean();
		}
		remove_filter( 'get_post_metadata', $meta_filter_wrapped, 10 );
		remove_filter( 'show_admin_bar', '__return_false', 99 );
		if ( $old ) {
			wp_cache_set( $id, $old, 'posts' );
		} else {
			wp_cache_delete( $id, 'posts' );
		}
		$wp_query        = $saved['query'];
		$wp_the_query    = $saved['the'];
		$GLOBALS['post'] = $saved['post'];
		wp_reset_postdata();
	}
	return is_string( $html ) ? $html : '';
}

/**
 * Deja el HTML listo para un iframe aislado: sin scripts ajenos y con <base> para las direcciones relativas.
 */
function ecos_wp_render_clean( $html ) {
	$html = preg_replace_callback(
		'#<script\b[^>]*>.*?</script>#is',
		function ( $m ) {
			return false !== strpos( $m[0], '/plugins/ecos/' ) ? $m[0] : '';
		},
		$html
	);
	$head = '<base href="' . esc_url( home_url( '/' ) ) . '">';
	if ( preg_match( '#<head\b[^>]*>#i', $html ) ) {
		return preg_replace( '#(<head\b[^>]*>)#i', '$1' . $head, $html, 1 );
	}
	return $head . $html;
}

function ecos_wp_rest_render( WP_REST_Request $request ) {
	$id   = absint( $request->get_param( 'id' ) );
	$type = 'page' === $request->get_param( 'type' ) ? 'page' : 'post';
	if ( $id ) {
		$existing = get_post( $id );
		if ( ! $existing ) {
			$id = 0;
		} elseif ( ! current_user_can( 'edit_post', $id ) ) {
			return new WP_Error( 'ecos_forbidden', 'No tienes permiso para esa entrada.', array( 'status' => 403 ) );
		} else {
			$type = 'page' === $existing->post_type ? 'page' : 'post';
		}
	}
	$content = (string) $request->get_param( 'content' );
	if ( ! current_user_can( 'unfiltered_html' ) ) {
		$content = wp_kses_post( $content );
	}
	$title   = wp_strip_all_tags( (string) $request->get_param( 'title' ) );
	$excerpt = wp_strip_all_tags( (string) $request->get_param( 'excerpt' ) );

	// Metas de Astra admitidas (y la imagen destacada), solo para esta vista previa.
	$meta    = array();
	$allowed = ecos_wp_astra_metas();
	$given   = $request->get_param( 'meta' );
	if ( is_array( $given ) ) {
		foreach ( $given as $k => $v ) {
			if ( isset( $allowed[ $k ] ) && is_string( $v ) && in_array( $v, $allowed[ $k ], true ) ) {
				$meta[ $k ] = $v;
			}
		}
	}
	$featured = absint( $request->get_param( 'featured_media' ) );
	if ( $featured ) {
		$meta['_thumbnail_id'] = $featured;
	}

	$post = ecos_wp_render_post( $id, $type, $title, $content, $excerpt );
	$html = ecos_wp_render_page( $post, $type, $meta );
	if ( '' === trim( $html ) ) {
		return new WP_Error( 'ecos_render_empty', 'El tema no devolvió ninguna página.', array( 'status' => 500 ) );
	}
	return rest_ensure_response(
		array(
			'plugin'  => 'ecos',
			'version' => ECOS_WP_VERSION,
			'html'    => ecos_wp_render_clean( $html ),
		)
	);
}

function ecos_wp_register_render_route() {
	register_rest_route(
		'ecos/v1',
		'/render',
		array(
			'methods'             => 'POST',
			'callback'            => 'ecos_wp_rest_render',
			'permission_callback' => 'ecos_wp_can_edit',
		)
	);
}
add_action( 'rest_api_init', 'ecos_wp_register_render_route' );
