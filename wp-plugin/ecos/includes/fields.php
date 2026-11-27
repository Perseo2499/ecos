<?php
/**
 * Ecos para WordPress · campos personalizados (1.8.0).
 *
 * GET  /wp-json/ecos/v1/fields?type=evento&post=12   (permiso edit_posts; con post, también edit_post de esa entrada)
 *      → { plugin, version, type, acf?:{ groups, values, rest }, metabox?:{ boxes, values }, meta?:{ keys, values } }
 *      Definiciones de ACF (acf_get_field_groups + acf_get_fields), de Meta Box y las metas registradas con
 *      register_post_meta(show_in_rest), y los valores de esa entrada (sin formato: ids de fotos, fechas Ymd…).
 * POST /wp-json/ecos/v1/fields { post, acf?:{nombre:valor}, metabox?:{id:valor} }  (permiso edit_post de la entrada)
 *      → guarda con update_field (ACF) y rwmb_set_meta o update_post_meta (Meta Box).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Campos de ACF que se ven con ese tipo de contenido (o con esa entrada).
 */
function ecos_wp_fields_acf( $type, $post_id ) {
	if ( ! function_exists( 'acf_get_field_groups' ) || ! function_exists( 'acf_get_fields' ) ) {
		return null;
	}
	$args = $post_id ? array( 'post_id' => $post_id ) : array( 'post_type' => $type );
	$out  = array(
		'groups' => array(),
		'values' => (object) array(),
		'rest'   => false,
	);
	$vals = array();
	foreach ( acf_get_field_groups( $args ) as $group ) {
		if ( isset( $group['active'] ) && ! $group['active'] ) {
			continue;
		}
		$fields = acf_get_fields( $group );
		if ( ! is_array( $fields ) ) {
			continue;
		}
		$list = array();
		foreach ( $fields as $f ) {
			$list[] = array(
				'key'           => isset( $f['key'] ) ? $f['key'] : '',
				'name'          => isset( $f['name'] ) ? $f['name'] : '',
				'label'         => isset( $f['label'] ) ? $f['label'] : '',
				'type'          => isset( $f['type'] ) ? $f['type'] : '',
				'required'      => ! empty( $f['required'] ),
				'instructions'  => isset( $f['instructions'] ) ? $f['instructions'] : '',
				'choices'       => isset( $f['choices'] ) ? $f['choices'] : null,
				'multiple'      => isset( $f['multiple'] ) ? (int) $f['multiple'] : 0,
				'min'           => isset( $f['min'] ) ? $f['min'] : '',
				'max'           => isset( $f['max'] ) ? $f['max'] : '',
				'step'          => isset( $f['step'] ) ? $f['step'] : '',
				'default_value' => isset( $f['default_value'] ) ? $f['default_value'] : null,
				'return_format' => isset( $f['return_format'] ) ? $f['return_format'] : '',
			);
			if ( $post_id && ! empty( $f['name'] ) ) {
				$vals[ $f['name'] ] = get_field( $f['key'], $post_id, false );
			}
		}
		$out['groups'][] = array(
			'key'    => isset( $group['key'] ) ? $group['key'] : '',
			'title'  => isset( $group['title'] ) ? $group['title'] : '',
			'fields' => $list,
		);
		// ¿Los campos de ACF salen en la API? (ACF 5.11+ con «Mostrar en REST»)
		if ( ! empty( $group['show_in_rest'] ) ) {
			$out['rest'] = true;
		}
	}
	if ( $vals ) {
		$out['values'] = $vals;
	}
	return $out;
}

/**
 * Cajas de Meta Box para ese tipo de contenido.
 */
function ecos_wp_fields_metabox( $type, $post_id ) {
	if ( ! function_exists( 'rwmb_get_registry' ) ) {
		return null;
	}
	$registry = rwmb_get_registry( 'meta_box' );
	if ( ! $registry || ! method_exists( $registry, 'all' ) ) {
		return null;
	}
	$out  = array(
		'boxes'  => array(),
		'values' => (object) array(),
	);
	$vals = array();
	foreach ( $registry->all() as $box ) {
		$meta = is_object( $box ) && isset( $box->meta_box ) ? $box->meta_box : ( is_array( $box ) ? $box : array() );
		$pts  = isset( $meta['post_types'] ) ? (array) $meta['post_types'] : array( 'post' );
		if ( ! in_array( $type, $pts, true ) ) {
			continue;
		}
		$fields = array();
		$defs   = isset( $meta['fields'] ) ? $meta['fields'] : array();
		foreach ( $defs as $f ) {
			if ( empty( $f['id'] ) ) {
				continue;
			}
			$fields[] = array(
				'id'       => $f['id'],
				'name'     => isset( $f['name'] ) ? $f['name'] : $f['id'],
				'type'     => isset( $f['type'] ) ? $f['type'] : 'text',
				'desc'     => isset( $f['desc'] ) ? $f['desc'] : '',
				'required' => ! empty( $f['required'] ),
				'options'  => isset( $f['options'] ) ? $f['options'] : null,
				'multiple' => ! empty( $f['multiple'] ),
				'clone'    => ! empty( $f['clone'] ),
				'min'      => isset( $f['min'] ) ? $f['min'] : '',
				'max'      => isset( $f['max'] ) ? $f['max'] : '',
				'step'     => isset( $f['step'] ) ? $f['step'] : '',
			);
			if ( $post_id ) {
				$vals[ $f['id'] ] = get_post_meta( $post_id, $f['id'], true );
			}
		}
		if ( $fields ) {
			$out['boxes'][] = array(
				'title'  => isset( $meta['title'] ) ? $meta['title'] : '',
				'fields' => $fields,
			);
		}
	}
	if ( $vals ) {
		$out['values'] = $vals;
	}
	return $out;
}

/**
 * Metas registradas con register_post_meta() y show_in_rest para ese tipo.
 */
function ecos_wp_fields_meta( $type, $post_id ) {
	$out  = array(
		'keys'   => array(),
		'values' => (object) array(),
	);
	$vals = array();
	foreach ( get_registered_meta_keys( 'post', $type ) as $key => $m ) {
		if ( empty( $m['show_in_rest'] ) ) {
			continue;
		}
		// Las de SEO, Astra y patrones tienen su propio sitio en Ecos
		if ( preg_match( '/^(_?yoast|rank_math|_rank_math|ast-|site-|theme-|footnotes|wp_pattern|_ecos|ecos_)/i', $key ) ) {
			continue;
		}
		$out['keys'][] = array(
			'key'         => $key,
			'type'        => isset( $m['type'] ) ? $m['type'] : 'string',
			'description' => isset( $m['description'] ) ? $m['description'] : '',
			'single'      => ! empty( $m['single'] ),
		);
		if ( $post_id ) {
			$vals[ $key ] = get_post_meta( $post_id, $key, ! empty( $m['single'] ) );
		}
	}
	if ( $vals ) {
		$out['values'] = $vals;
	}
	return $out;
}

function ecos_wp_rest_fields_get( $request ) {
	$type    = sanitize_key( (string) $request->get_param( 'type' ) );
	$post_id = absint( $request->get_param( 'post' ) );
	if ( $post_id ) {
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return new WP_Error( 'ecos_forbidden', 'No tienes permiso para editar esta entrada.', array( 'status' => 403 ) );
		}
		$real = get_post_type( $post_id );
		if ( $real ) {
			$type = $real;
		}
	}
	if ( '' === $type ) {
		$type = 'post';
	}
	$res = array(
		'plugin'  => 'ecos',
		'version' => ECOS_WP_VERSION,
		'type'    => $type,
		'meta'    => ecos_wp_fields_meta( $type, $post_id ),
	);
	$acf = ecos_wp_fields_acf( $type, $post_id );
	if ( null !== $acf ) {
		$res['acf'] = $acf;
	}
	$mb = ecos_wp_fields_metabox( $type, $post_id );
	if ( null !== $mb ) {
		$res['metabox'] = $mb;
	}
	return rest_ensure_response( $res );
}

function ecos_wp_rest_fields_save( $request ) {
	$post_id = absint( $request->get_param( 'post' ) );
	if ( ! $post_id || ! current_user_can( 'edit_post', $post_id ) ) {
		return new WP_Error( 'ecos_forbidden', 'No tienes permiso para editar esta entrada.', array( 'status' => 403 ) );
	}
	$saved = array();
	$acf   = $request->get_param( 'acf' );
	if ( is_array( $acf ) && function_exists( 'update_field' ) ) {
		foreach ( $acf as $name => $value ) {
			$name = sanitize_text_field( (string) $name );
			if ( '' === $name ) {
				continue;
			}
			update_field( $name, $value, $post_id );
			$saved[] = 'acf:' . $name;
		}
	}
	$mb = $request->get_param( 'metabox' );
	if ( is_array( $mb ) ) {
		foreach ( $mb as $id => $value ) {
			$id = sanitize_text_field( (string) $id );
			if ( '' === $id ) {
				continue;
			}
			if ( function_exists( 'rwmb_set_meta' ) ) {
				rwmb_set_meta( $post_id, $id, $value );
			} else {
				update_post_meta( $post_id, $id, $value );
			}
			$saved[] = 'metabox:' . $id;
		}
	}
	return rest_ensure_response(
		array(
			'plugin' => 'ecos',
			'saved'  => $saved,
		)
	);
}

function ecos_wp_register_fields_routes() {
	register_rest_route(
		'ecos/v1',
		'/fields',
		array(
			array(
				'methods'             => 'GET',
				'callback'            => 'ecos_wp_rest_fields_get',
				'permission_callback' => 'ecos_wp_can_edit',
			),
			array(
				'methods'             => 'POST',
				'callback'            => 'ecos_wp_rest_fields_save',
				'permission_callback' => 'ecos_wp_can_edit',
			),
		)
	);
}
add_action( 'rest_api_init', 'ecos_wp_register_fields_routes' );
