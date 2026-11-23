<?php
/**
 * Ecos para WordPress · vista previa al compartir (Open Graph / Twitter Card) y datos estructurados (JSON-LD).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Nombre del plugin SEO activo que ya pone estas etiquetas ('' si no hay ninguno).
 */
function ecos_wp_seo_plugin_name() {
	if ( defined( 'WPSEO_VERSION' ) || class_exists( 'WPSEO_Options' ) ) {
		return 'Yoast SEO';
	}
	if ( defined( 'RANK_MATH_VERSION' ) || class_exists( 'RankMath' ) ) {
		return 'Rank Math';
	}
	if ( defined( 'AIOSEO_VERSION' ) || function_exists( 'aioseo' ) ) {
		return 'All in One SEO';
	}
	if ( defined( 'SEOPRESS_VERSION' ) || function_exists( 'seopress_init' ) ) {
		return 'SEOPress';
	}
	if ( defined( 'THE_SEO_FRAMEWORK_VERSION' ) || function_exists( 'the_seo_framework' ) ) {
		return 'The SEO Framework';
	}
	return '';
}

function ecos_wp_seo_plugin_active() {
	return (bool) apply_filters( 'ecos_wp_seo_plugin_active', '' !== ecos_wp_seo_plugin_name() );
}

/**
 * Datos de la asociación (se guardan desde Ecos: REST ecos/v1/settings).
 */
function ecos_wp_default_settings() {
	return array(
		'name'      => '',
		'street'    => '',
		'postal'    => '',
		'city'      => '',
		'email'     => '',
		'phone'     => '',
		'instagram' => '',
		'facebook'  => '',
	);
}

function ecos_wp_get_settings() {
	$saved = get_option( 'ecos_wp_settings', null );
	if ( ! is_array( $saved ) ) {
		return array(
			'saved'    => false,
			'settings' => ecos_wp_default_settings(),
		);
	}
	return array(
		'saved'    => true,
		'settings' => array_merge( ecos_wp_default_settings(), $saved ),
	);
}

function ecos_wp_sanitize_settings( $in ) {
	$in  = is_array( $in ) ? $in : array();
	$out = ecos_wp_default_settings();
	foreach ( array( 'name', 'street', 'postal', 'city', 'phone' ) as $k ) {
		$out[ $k ] = isset( $in[ $k ] ) ? sanitize_text_field( (string) $in[ $k ] ) : '';
	}
	$out['email'] = isset( $in['email'] ) ? sanitize_email( (string) $in['email'] ) : '';
	foreach ( array( 'instagram', 'facebook' ) as $k ) {
		$out[ $k ] = isset( $in[ $k ] ) ? esc_url_raw( trim( (string) $in[ $k ] ), array( 'http', 'https' ) ) : '';
	}
	return $out;
}

/**
 * Texto corto sin etiquetas ni shortcodes.
 */
function ecos_wp_plain_excerpt( $post, $words = 35 ) {
	$text = has_excerpt( $post ) ? $post->post_excerpt : $post->post_content;
	$text = strip_shortcodes( $text );
	$text = wp_strip_all_tags( $text );
	$text = trim( preg_replace( '/\s+/u', ' ', html_entity_decode( $text, ENT_QUOTES, 'UTF-8' ) ) );
	return wp_trim_words( $text, $words, '…' );
}

/**
 * Descripción: la de SEO que Ecos guarda en el campo de Yoast/Rank Math (si existe), el extracto o las primeras frases.
 */
function ecos_wp_post_description( $post ) {
	foreach ( array( '_yoast_wpseo_metadesc', 'rank_math_description' ) as $key ) {
		$v = get_post_meta( $post->ID, $key, true );
		if ( is_string( $v ) && '' !== trim( $v ) ) {
			return trim( wp_strip_all_tags( $v ) );
		}
	}
	return ecos_wp_plain_excerpt( $post );
}

function ecos_wp_logo_url() {
	$id = (int) get_theme_mod( 'custom_logo' );
	if ( $id ) {
		$src = wp_get_attachment_image_url( $id, 'full' );
		if ( $src ) {
			return $src;
		}
	}
	$icon = get_site_icon_url( 512 );
	return $icon ? $icon : '';
}

/**
 * Imagen: destacada, primera del contenido, logo o icono.
 */
function ecos_wp_post_image( $post ) {
	$src = get_the_post_thumbnail_url( $post, 'large' );
	if ( $src ) {
		return $src;
	}
	if ( preg_match( '/<img[^>]+src=["\']([^"\']+)["\']/i', (string) $post->post_content, $m ) ) {
		return html_entity_decode( $m[1], ENT_QUOTES, 'UTF-8' );
	}
	return ecos_wp_logo_url();
}

/**
 * Datos de la página actual para las etiquetas; null si no toca ponerlas.
 */
function ecos_wp_page_meta() {
	$site = get_bloginfo( 'name' );
	if ( is_singular() ) {
		$post = get_queried_object();
		if ( ! ( $post instanceof WP_Post ) || ! empty( $post->post_password ) || 'publish' !== $post->post_status ) {
			return null;
		}
		if ( is_front_page() ) {
			$desc = get_bloginfo( 'description' );
			return array(
				'type'  => 'website',
				'title' => $site,
				'desc'  => $desc ? $desc : ecos_wp_post_description( $post ),
				'url'   => home_url( '/' ),
				'image' => ecos_wp_post_image( $post ),
				'post'  => null,
			);
		}
		return array(
			'type'  => 'post' === $post->post_type ? 'article' : 'website',
			'title' => wp_strip_all_tags( get_the_title( $post ) ),
			'desc'  => ecos_wp_post_description( $post ),
			'url'   => get_permalink( $post ),
			'image' => ecos_wp_post_image( $post ),
			'post'  => $post,
		);
	}
	if ( is_front_page() || is_home() ) {
		return array(
			'type'  => 'website',
			'title' => $site,
			'desc'  => get_bloginfo( 'description' ),
			'url'   => home_url( '/' ),
			'image' => ecos_wp_logo_url(),
			'post'  => null,
		);
	}
	return null;
}

function ecos_wp_print_social() {
	if ( ecos_wp_seo_plugin_active() ) {
		return;
	}
	$m = ecos_wp_page_meta();
	if ( ! $m ) {
		return;
	}
	$tags = array(
		array( 'property', 'og:locale', 'es_ES' ),
		array( 'property', 'og:type', $m['type'] ),
		array( 'property', 'og:site_name', get_bloginfo( 'name' ) ),
		array( 'property', 'og:title', $m['title'] ),
		array( 'property', 'og:description', $m['desc'] ),
		array( 'property', 'og:url', $m['url'] ),
		array( 'property', 'og:image', $m['image'] ),
		array( 'name', 'twitter:card', 'summary_large_image' ),
		array( 'name', 'twitter:title', $m['title'] ),
		array( 'name', 'twitter:description', $m['desc'] ),
		array( 'name', 'twitter:image', $m['image'] ),
	);
	if ( $m['post'] && 'article' === $m['type'] ) {
		$tags[] = array( 'property', 'article:published_time', get_the_date( 'c', $m['post'] ) );
		$tags[] = array( 'property', 'article:modified_time', get_the_modified_date( 'c', $m['post'] ) );
	}
	echo "\n<!-- Ecos para WordPress: vista previa al compartir -->\n";
	foreach ( $tags as $t ) {
		if ( '' === (string) $t[2] ) {
			continue;
		}
		$val = in_array( $t[1], array( 'og:url', 'og:image', 'twitter:image' ), true ) ? esc_url( $t[2] ) : esc_attr( $t[2] );
		printf( "<meta %s=\"%s\" content=\"%s\" />\n", esc_attr( $t[0] ), esc_attr( $t[1] ), $val ); // phpcs:ignore WordPress.Security.EscapeOutput
	}
}
add_action( 'wp_head', 'ecos_wp_print_social', 5 );

/**
 * Organización para JSON-LD (NGO).
 */
function ecos_wp_org_schema() {
	$cfg = ecos_wp_get_settings();
	$s   = $cfg['settings'];
	$org = array(
		'@type' => 'NGO',
		'@id'   => home_url( '/#organization' ),
		'name'  => '' !== $s['name'] ? $s['name'] : get_bloginfo( 'name' ),
		'url'   => home_url( '/' ),
	);
	$logo = ecos_wp_logo_url();
	if ( $logo ) {
		$org['logo'] = $logo;
	}
	if ( '' !== $s['street'] || '' !== $s['city'] || '' !== $s['postal'] ) {
		$addr = array(
			'@type'          => 'PostalAddress',
			'addressCountry' => 'ES',
		);
		if ( '' !== $s['street'] ) {
			$addr['streetAddress'] = $s['street'];
		}
		if ( '' !== $s['postal'] ) {
			$addr['postalCode'] = $s['postal'];
		}
		if ( '' !== $s['city'] ) {
			$addr['addressLocality'] = $s['city'];
		}
		$org['address'] = $addr;
	}
	if ( '' !== $s['email'] ) {
		$org['email'] = $s['email'];
	}
	if ( '' !== $s['phone'] ) {
		$org['telephone'] = $s['phone'];
	}
	$same = array_values( array_filter( array( $s['instagram'], $s['facebook'] ) ) );
	if ( $same ) {
		$org['sameAs'] = $same;
	}
	return $org;
}

function ecos_wp_print_jsonld() {
	if ( ecos_wp_seo_plugin_active() ) {
		return;
	}
	$data = null;
	if ( is_front_page() ) {
		$data = array_merge( array( '@context' => 'https://schema.org' ), ecos_wp_org_schema() );
	} elseif ( is_singular( 'post' ) ) {
		$post = get_queried_object();
		if ( ! ( $post instanceof WP_Post ) || ! empty( $post->post_password ) || 'publish' !== $post->post_status ) {
			return;
		}
		$org       = ecos_wp_org_schema();
		$publisher = array(
			'@type' => 'Organization',
			'name'  => $org['name'],
			'url'   => $org['url'],
		);
		if ( ! empty( $org['logo'] ) ) {
			$publisher['logo'] = array(
				'@type' => 'ImageObject',
				'url'   => $org['logo'],
			);
		}
		$data = array(
			'@context'         => 'https://schema.org',
			'@type'            => 'BlogPosting',
			'headline'         => wp_strip_all_tags( get_the_title( $post ) ),
			'mainEntityOfPage' => get_permalink( $post ),
			'datePublished'    => get_the_date( 'c', $post ),
			'dateModified'     => get_the_modified_date( 'c', $post ),
			'author'           => array(
				'@type' => 'Organization',
				'name'  => $org['name'],
				'url'   => $org['url'],
			),
			'publisher'        => $publisher,
		);
		$img = ecos_wp_post_image( $post );
		if ( $img ) {
			$data['image'] = array( $img );
		}
		$desc = ecos_wp_post_description( $post );
		if ( '' !== $desc ) {
			$data['description'] = $desc;
		}
	}
	if ( ! $data ) {
		return;
	}
	echo "\n<script type=\"application/ld+json\">" . wp_json_encode( $data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP ) . "</script>\n"; // phpcs:ignore WordPress.Security.EscapeOutput
}
add_action( 'wp_head', 'ecos_wp_print_jsonld', 6 );
