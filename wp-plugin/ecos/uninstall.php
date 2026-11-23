<?php
/**
 * Al borrar el complemento: elimina la tabla de visitas y sus opciones.
 */
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

global $wpdb;
$wpdb->query( "DROP TABLE IF EXISTS {$wpdb->prefix}ecos_views" ); // phpcs:ignore WordPress.DB
delete_option( 'ecos_wp_settings' );
delete_option( 'ecos_wp_db' );
$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\\_transient\\_ecos\\_rl\\_%' OR option_name LIKE '\\_transient\\_timeout\\_ecos\\_rl\\_%'" ); // phpcs:ignore WordPress.DB
