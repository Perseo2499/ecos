<?php
/**
 * Revisión entre varias personas (Ecos 1.8.0): notas internas de una entrada, resumen de pendientes y devueltas,
 * actividad reciente y quién cambió por última vez una entrada.
 *
 * Las notas se guardan como comentarios de tipo «ecos_note» con un estado de aprobación propio («ecos_note»):
 * no son comentarios públicos, no salen en la web, ni en /wp/v2/comments, ni en los feeds, ni en los contadores.
 * (Las «Notas» de WordPress 6.9 van ligadas a los metadatos de bloque del editor de WordPress; estas funcionan igual
 * en cualquier versión y con el editor de Ecos.)
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ECOS_NOTE_TYPE', 'ecos_note' );

/**
 * Las notas nunca salen en consultas de comentarios que no las pidan expresamente (temas, feeds, contadores, REST).
 */
function ecos_wp_note_hide_from_queries( $query ) {
	$vars = $query->query_vars;
	if ( ! empty( $vars['type'] ) || ! empty( $vars['type__in'] ) ) {
		return;
	}
	$not = isset( $vars['type__not_in'] ) ? (array) $vars['type__not_in'] : array();
	if ( ! in_array( ECOS_NOTE_TYPE, $not, true ) ) {
		$not[] = ECOS_NOTE_TYPE;
	}
	$query->query_vars['type__not_in'] = $not;
}
add_action( 'pre_get_comments', 'ecos_wp_note_hide_from_queries' );

/**
 * Quién cambió la entrada por última vez (meta propia; sin ella, la última revisión; sin ella, la autora).
 */
function ecos_wp_remember_editor( $post_id, $post ) {
	if ( wp_is_post_revision( $post_id ) || wp_is_post_autosave( $post_id ) || ! is_user_logged_in() ) {
		return;
	}
	update_post_meta( $post_id, '_ecos_last_editor', get_current_user_id() );
}
add_action( 'save_post', 'ecos_wp_remember_editor', 20, 2 );

/**
 * «Devuelta con comentarios»: la marca se quita en cuanto la entrada vuelve a revisión o se publica.
 */
function ecos_wp_clear_returned( $new_status, $old_status, $post ) {
	if ( in_array( $new_status, array( 'pending', 'publish', 'future' ), true ) ) {
		delete_post_meta( $post->ID, '_ecos_returned' );
	}
}
add_action( 'transition_post_status', 'ecos_wp_clear_returned', 10, 3 );

function ecos_wp_person( $user_id ) {
	$user = get_userdata( (int) $user_id );
	if ( ! $user ) {
		return array(
			'id'     => 0,
			'name'   => '',
			'avatar' => '',
		);
	}
	return array(
		'id'     => (int) $user->ID,
		'name'   => $user->display_name,
		'avatar' => get_avatar_url( $user->ID, array( 'size' => 48 ) ),
	);
}

function ecos_wp_iso( $gmt ) {
	return $gmt && '0000-00-00 00:00:00' !== $gmt ? str_replace( ' ', 'T', $gmt ) . 'Z' : null;
}

function ecos_wp_note_format( $c ) {
	$me = get_current_user_id();
	return array(
		'id'        => (int) $c->comment_ID,
		'post'      => (int) $c->comment_post_ID,
		'parent'    => (int) $c->comment_parent,
		'author'    => ecos_wp_person( $c->user_id ),
		'date'      => ecos_wp_iso( $c->comment_date_gmt ),
		'text'      => $c->comment_content,
		'anchor'    => (string) get_comment_meta( $c->comment_ID, 'ecos_anchor', true ),
		'block'     => (string) get_comment_meta( $c->comment_ID, 'ecos_block', true ),
		'kind'      => (string) ( get_comment_meta( $c->comment_ID, 'ecos_kind', true ) ? get_comment_meta( $c->comment_ID, 'ecos_kind', true ) : 'note' ),
		'resolved'  => '1' === get_comment_meta( $c->comment_ID, 'ecos_resolved', true ),
		'canDelete' => ( (int) $c->user_id === $me ) || current_user_can( 'edit_others_posts' ),
	);
}

function ecos_wp_note_get( $id ) {
	$c = get_comment( (int) $id );
	return ( $c && ECOS_NOTE_TYPE === $c->comment_type ) ? $c : null;
}

function ecos_wp_notes_can_post( WP_REST_Request $request ) {
	$id = absint( $request->get_param( 'post' ) );
	return $id && current_user_can( 'edit_post', $id );
}

function ecos_wp_notes_can_note( WP_REST_Request $request ) {
	$c = ecos_wp_note_get( $request['id'] );
	return $c && current_user_can( 'edit_post', (int) $c->comment_post_ID );
}

/**
 * GET ecos/v1/notes?post=ID → { notes: [...] } (todas las notas de la entrada, en orden de fecha).
 */
function ecos_wp_rest_notes_list( WP_REST_Request $request ) {
	$post_id = absint( $request->get_param( 'post' ) );
	if ( ! get_post( $post_id ) ) {
		return new WP_Error( 'ecos_not_found', 'No existe esa entrada.', array( 'status' => 404 ) );
	}
	$comments = get_comments(
		array(
			'post_id' => $post_id,
			'type'    => ECOS_NOTE_TYPE,
			'status'  => ECOS_NOTE_TYPE,
			'orderby' => 'comment_date_gmt',
			'order'   => 'ASC',
			'number'  => 500,
		)
	);
	return rest_ensure_response(
		array(
			'plugin' => 'ecos',
			'post'   => $post_id,
			'notes'  => array_map( 'ecos_wp_note_format', $comments ),
		)
	);
}

/**
 * POST ecos/v1/notes { post, text, anchor?, block?, parent?, kind? }: añade una nota o una respuesta.
 * kind: «note» (por defecto) o «return» (devolver con comentarios: solo quien puede editar entradas ajenas; marca la entrada como devuelta).
 */
function ecos_wp_rest_notes_add( WP_REST_Request $request ) {
	$post_id = absint( $request->get_param( 'post' ) );
	$post    = get_post( $post_id );
	if ( ! $post ) {
		return new WP_Error( 'ecos_not_found', 'No existe esa entrada.', array( 'status' => 404 ) );
	}
	$text = trim( wp_kses( (string) $request->get_param( 'text' ), array() ) );
	if ( '' === $text ) {
		return new WP_Error( 'ecos_empty', 'Escribe el texto de la nota.', array( 'status' => 400 ) );
	}
	$text   = function_exists( 'mb_substr' ) ? mb_substr( $text, 0, 4000 ) : substr( $text, 0, 4000 );
	$parent = absint( $request->get_param( 'parent' ) );
	if ( $parent ) {
		$pc = ecos_wp_note_get( $parent );
		if ( ! $pc || (int) $pc->comment_post_ID !== $post_id ) {
			return new WP_Error( 'ecos_bad_parent', 'La nota a la que respondes no existe.', array( 'status' => 400 ) );
		}
	}
	$kind = 'return' === $request->get_param( 'kind' ) ? 'return' : 'note';
	if ( 'return' === $kind && ! current_user_can( 'edit_others_posts' ) ) {
		return new WP_Error( 'ecos_forbidden', 'No puedes devolver entradas con comentarios.', array( 'status' => 403 ) );
	}
	$user = wp_get_current_user();
	$cid  = wp_insert_comment(
		array(
			'comment_post_ID'      => $post_id,
			'comment_content'      => $text,
			'comment_type'         => ECOS_NOTE_TYPE,
			'comment_approved'     => ECOS_NOTE_TYPE,
			'comment_parent'       => $parent,
			'user_id'              => $user->ID,
			'comment_author'       => $user->display_name,
			'comment_author_email' => $user->user_email,
			'comment_author_url'   => '',
			'comment_author_IP'    => '',
			'comment_agent'        => '',
		)
	);
	if ( ! $cid ) {
		return new WP_Error( 'ecos_insert', 'No se pudo guardar la nota.', array( 'status' => 500 ) );
	}
	$anchor = sanitize_key( (string) $request->get_param( 'anchor' ) );
	if ( $anchor && ! $parent ) {
		update_comment_meta( $cid, 'ecos_anchor', $anchor );
		update_comment_meta( $cid, 'ecos_block', sanitize_key( (string) $request->get_param( 'block' ) ) );
	}
	if ( 'return' === $kind ) {
		update_comment_meta( $cid, 'ecos_kind', 'return' );
		update_post_meta(
			$post_id,
			'_ecos_returned',
			array(
				'by'   => (int) $user->ID,
				'at'   => gmdate( 'Y-m-d H:i:s' ),
				'note' => (int) $cid,
			)
		);
	}
	return rest_ensure_response( array( 'note' => ecos_wp_note_format( get_comment( $cid ) ) ) );
}

/**
 * PATCH ecos/v1/notes/<id> { resolved }: marca un hilo como resuelto (o lo reabre).
 */
function ecos_wp_rest_notes_patch( WP_REST_Request $request ) {
	$c = ecos_wp_note_get( $request['id'] );
	if ( ! $c ) {
		return new WP_Error( 'ecos_not_found', 'No existe esa nota.', array( 'status' => 404 ) );
	}
	if ( null !== $request->get_param( 'resolved' ) ) {
		$on = rest_sanitize_boolean( $request->get_param( 'resolved' ) );
		if ( $on ) {
			update_comment_meta( $c->comment_ID, 'ecos_resolved', '1' );
		} else {
			delete_comment_meta( $c->comment_ID, 'ecos_resolved' );
		}
	}
	return rest_ensure_response( array( 'note' => ecos_wp_note_format( get_comment( $c->comment_ID ) ) ) );
}

/**
 * DELETE ecos/v1/notes/<id>: la borra su autora o quien puede editar entradas ajenas (con sus respuestas).
 */
function ecos_wp_rest_notes_delete( WP_REST_Request $request ) {
	$c = ecos_wp_note_get( $request['id'] );
	if ( ! $c ) {
		return new WP_Error( 'ecos_not_found', 'No existe esa nota.', array( 'status' => 404 ) );
	}
	if ( (int) $c->user_id !== get_current_user_id() && ! current_user_can( 'edit_others_posts' ) ) {
		return new WP_Error( 'ecos_forbidden', 'Solo puede borrar la nota quien la escribió o quien edita entradas ajenas.', array( 'status' => 403 ) );
	}
	$ids = array( (int) $c->comment_ID );
	$kids = get_comments(
		array(
			'parent' => (int) $c->comment_ID,
			'type'   => ECOS_NOTE_TYPE,
			'status' => ECOS_NOTE_TYPE,
			'fields' => 'ids',
		)
	);
	$ids = array_merge( $ids, array_map( 'intval', $kids ) );
	foreach ( array_reverse( $ids ) as $cid ) {
		wp_delete_comment( $cid, true );
	}
	return rest_ensure_response( array( 'deleted' => $ids ) );
}

function ecos_wp_open_notes( $post_id ) {
	$n = 0;
	$roots = get_comments(
		array(
			'post_id' => (int) $post_id,
			'type'    => ECOS_NOTE_TYPE,
			'status'  => ECOS_NOTE_TYPE,
			'parent'  => 0,
		)
	);
	foreach ( $roots as $r ) {
		if ( '1' !== get_comment_meta( $r->comment_ID, 'ecos_resolved', true ) ) {
			++$n;
		}
	}
	return $n;
}

function ecos_wp_post_brief( $p ) {
	return array(
		'id'        => (int) $p->ID,
		'type'      => $p->post_type,
		'title'     => get_the_title( $p ),
		'status'    => $p->post_status,
		'date'      => ecos_wp_iso( $p->post_date_gmt ),
		'modified'  => ecos_wp_iso( $p->post_modified_gmt ),
		'author'    => ecos_wp_person( $p->post_author ),
		'editor'    => ecos_wp_person( get_post_meta( $p->ID, '_ecos_last_editor', true ) ),
		'openNotes' => ecos_wp_open_notes( $p->ID ),
	);
}

/**
 * GET ecos/v1/review → { pending, returned, activity }
 *  · pending: entradas pendientes de revisión (solo para quien puede editar entradas ajenas);
 *  · returned: entradas mías que me han devuelto con comentarios;
 *  · activity: lo último que se ha cambiado (de lo que puedo editar).
 */
function ecos_wp_rest_review() {
	$me   = get_current_user_id();
	$out  = array(
		'plugin'   => 'ecos',
		'pending'  => array(),
		'returned' => array(),
		'activity' => array(),
	);
	$types = array( 'post', 'page' );
	if ( current_user_can( 'edit_others_posts' ) ) {
		$pending = get_posts(
			array(
				'post_type'      => $types,
				'post_status'    => 'pending',
				'posts_per_page' => 50,
				'orderby'        => 'modified',
				'order'          => 'DESC',
				'no_found_rows'  => true,
			)
		);
		foreach ( $pending as $p ) {
			$out['pending'][] = ecos_wp_post_brief( $p );
		}
	}
	$mine = get_posts(
		array(
			'post_type'      => $types,
			'post_status'    => 'draft',
			'author'         => $me,
			'posts_per_page' => 30,
			'meta_key'       => '_ecos_returned', // phpcs:ignore WordPress.DB.SlowDBQuery
			'orderby'        => 'modified',
			'order'          => 'DESC',
			'no_found_rows'  => true,
		)
	);
	foreach ( $mine as $p ) {
		$brief = ecos_wp_post_brief( $p );
		$r     = get_post_meta( $p->ID, '_ecos_returned', true );
		if ( is_array( $r ) ) {
			$brief['returnedBy'] = ecos_wp_person( isset( $r['by'] ) ? $r['by'] : 0 );
			$brief['returnedAt'] = ! empty( $r['at'] ) ? ecos_wp_iso( $r['at'] ) : null;
			$note                = ! empty( $r['note'] ) ? get_comment( (int) $r['note'] ) : null;
			$brief['returnedText'] = $note ? wp_trim_words( $note->comment_content, 30, '…' ) : '';
		}
		$out['returned'][] = $brief;
	}
	$recent = get_posts(
		array(
			'post_type'      => $types,
			'post_status'    => array( 'publish', 'future', 'draft', 'pending', 'private' ),
			'posts_per_page' => 12,
			'orderby'        => 'modified',
			'order'          => 'DESC',
			'perm'           => 'editable',
			'no_found_rows'  => true,
		)
	);
	foreach ( $recent as $p ) {
		$brief             = ecos_wp_post_brief( $p );
		$brief['returned'] = (bool) get_post_meta( $p->ID, '_ecos_returned', true );
		$out['activity'][] = $brief;
	}
	return rest_ensure_response( $out );
}

/**
 * GET ecos/v1/changes?id=ID → { modified, status, by } (quién la cambió por última vez).
 */
function ecos_wp_rest_changes( WP_REST_Request $request ) {
	$id   = absint( $request->get_param( 'id' ) );
	$post = get_post( $id );
	if ( ! $post || ! current_user_can( 'edit_post', $id ) ) {
		return new WP_Error( 'ecos_not_found', 'No existe esa entrada.', array( 'status' => 404 ) );
	}
	$by = (int) get_post_meta( $id, '_ecos_last_editor', true );
	if ( ! $by ) {
		$revs = wp_get_post_revisions( $id, array( 'numberposts' => 1 ) );
		if ( $revs ) {
			$first = reset( $revs );
			$by    = (int) $first->post_author;
		}
	}
	if ( ! $by ) {
		$by = (int) $post->post_author;
	}
	return rest_ensure_response(
		array(
			'id'       => $id,
			'status'   => $post->post_status,
			'modified' => ecos_wp_iso( $post->post_modified_gmt ),
			'by'       => ecos_wp_person( $by ),
		)
	);
}

function ecos_wp_can_review_summary() {
	return current_user_can( 'edit_posts' );
}

function ecos_wp_register_review_routes() {
	register_rest_route(
		'ecos/v1',
		'/notes',
		array(
			array(
				'methods'             => 'GET',
				'callback'            => 'ecos_wp_rest_notes_list',
				'permission_callback' => 'ecos_wp_notes_can_post',
				'args'                => array(
					'post' => array(
						'required'          => true,
						'sanitize_callback' => 'absint',
					),
				),
			),
			array(
				'methods'             => 'POST',
				'callback'            => 'ecos_wp_rest_notes_add',
				'permission_callback' => 'ecos_wp_notes_can_post',
				'args'                => array(
					'post' => array(
						'required'          => true,
						'sanitize_callback' => 'absint',
					),
				),
			),
		)
	);
	register_rest_route(
		'ecos/v1',
		'/notes/(?P<id>\d+)',
		array(
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'callback'            => 'ecos_wp_rest_notes_patch',
				'permission_callback' => 'ecos_wp_notes_can_note',
			),
			array(
				'methods'             => 'DELETE',
				'callback'            => 'ecos_wp_rest_notes_delete',
				'permission_callback' => 'ecos_wp_notes_can_note',
			),
		)
	);
	register_rest_route(
		'ecos/v1',
		'/review',
		array(
			'methods'             => 'GET',
			'callback'            => 'ecos_wp_rest_review',
			'permission_callback' => 'ecos_wp_can_review_summary',
		)
	);
	register_rest_route(
		'ecos/v1',
		'/changes',
		array(
			'methods'             => 'GET',
			'callback'            => 'ecos_wp_rest_changes',
			'permission_callback' => 'ecos_wp_can_review_summary',
			'args'                => array(
				'id' => array(
					'required'          => true,
					'sanitize_callback' => 'absint',
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'ecos_wp_register_review_routes' );
