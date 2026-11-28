#!/usr/bin/env bash
# Levanta WordPress + MySQL con Docker y lo deja listo para `npm run test:wp`:
# tema Astra, plugins Spectra, Kadence Blocks, GenerateBlocks, Yoast SEO, Rank Math (sin activar), ACF y Polylang (con un tipo «evento», un grupo de campos y los idiomas es/en), el Complemento de Ecos (build/ecos-wordpress.zip), un usuario administrador, un colaborador y un editor con sus contraseñas de aplicación.
#
# Antes: `npm run plugin` (genera build/ecos-wordpress.zip). Después: `npm run test:wp` con las variables que se muestran (en GitHub se exportan solas).
# Códigos de salida: 0 listo · 10 no se pudo descargar algo de internet (imágenes de Docker, wordpress.org: se avisa, no es un fallo de Ecos) · otro: fallo real.
set -uo pipefail
cd "$(dirname "$0")"

PORT="${WP_PORT:-8080}"
SITE="http://localhost:${PORT}"
USER_NAME="ecostest"
EXTERNAL=10

retry() { # retry <intentos> <comando…>  (espera creciente: 10 s, 20 s…)
  local max="$1"; shift; local n=0
  until "$@"; do
    n=$((n + 1))
    if [ "$n" -ge "$max" ]; then return 1; fi
    echo "::notice::Reintento $n/$max: $*" >&2
    sleep $((n * 10))
  done
}
wp() { docker compose --profile tools run --rm -T wpcli wp "$@"; }
need_external() { # need_external <descripción> <comando…>
  local what="$1"; shift
  if ! retry 4 "$@"; then echo "::warning::No se pudo $what (¿servicio externo caído o sin red?)" >&2; exit "$EXTERNAL"; fi
}

[ -f ../build/ecos-wordpress.zip ] || { echo "Falta build/ecos-wordpress.zip: ejecuta antes «npm run plugin»." >&2; exit 1; }

echo "== Imágenes y contenedores"
need_external "descargar las imágenes de Docker" docker compose --profile tools pull
docker compose up -d || exit 1

echo "== Esperando a WordPress"
ready=0
for _ in $(seq 1 40); do
  # la web responde (el instalador da 200) y wp-config.php ya existe; no se usa «wp db check»: su cliente MySQL exige TLS
  # verificado y el certificado de la imagen de MySQL es autofirmado, así que fallaba siempre aunque todo estuviera bien
  code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE/wp-admin/install.php" || true)
  if [ "$code" = 200 ] && wp config path >/dev/null 2>&1; then ready=1; break; fi
  sleep 5
done
[ "$ready" = 1 ] || { echo "WordPress/MySQL no arrancaron (última respuesta: ${code:-ninguna})" >&2; wp config path >&2 || true; docker compose logs --tail=60 >&2; exit 1; }

echo "== Instalando WordPress"
wp core install --url="$SITE" --title="Ecos pruebas" --admin_user=admin --admin_password="$(openssl rand -hex 12)" --admin_email=admin@example.org --skip-email || exit 1
wp rewrite structure '/%postname%/' --hard || exit 1   # sin enlaces permanentes /wp-json/ no responde en la imagen oficial

echo "== Tema y plugins (wordpress.org)"
need_external "instalar el tema Astra" wp theme install astra --activate
need_external "instalar Spectra, Kadence Blocks, GenerateBlocks y Yoast SEO" wp plugin install ultimate-addons-for-gutenberg kadence-blocks generateblocks wordpress-seo --activate
# Rank Math: se instala SIN activar (el test lo activa y desactiva por la REST /wp/v2/plugins para no afectar al resto de casos)
need_external "instalar Rank Math" wp plugin install seo-by-rank-math
# Sin conectar la cuenta de Rank Math (o pulsar «Saltar» en su registro) el complemento NO pinta nada en la web (init_frontend sale si is_invalid_registration()):
# la opción rank_math_registration_skip es la que guarda el botón «Skip Now» del asistente.
wp option update rank_math_registration_skip 1 || exit 1

# Astra 4 trae «sin barra lateral» por defecto: se activa a la derecha para poder probar los widgets en la web
wp eval '$o = get_option( "astra-settings", array() ); $o = is_array( $o ) ? $o : array(); foreach ( array( "site-sidebar-layout", "single-post-sidebar-layout", "archive-post-sidebar-layout" ) as $k ) { $o[ $k ] = "right-sidebar"; } update_option( "astra-settings", $o );' || exit 1

echo "== ACF y Polylang (campos personalizados e idiomas)"
need_external "instalar ACF y Polylang" wp plugin install advanced-custom-fields polylang --activate
# mu-plugin de pruebas: tipo «evento» (show_in_rest), un meta registrado, un grupo de ACF con «Mostrar en REST» y Polylang para entradas y eventos
MU_B64="$(base64 -w0 <<'PHP'
<?php
add_action( 'init', function () {
	register_taxonomy( 'tema', 'evento', array( 'label' => 'Temas', 'hierarchical' => true, 'show_in_rest' => true, 'rest_base' => 'temas' ) );
	register_post_type( 'evento', array(
		'label' => 'Eventos', 'labels' => array( 'singular_name' => 'Evento' ), 'public' => true, 'show_in_rest' => true, 'rest_base' => 'eventos',
		'supports' => array( 'title', 'editor', 'excerpt', 'thumbnail', 'custom-fields' ), 'taxonomies' => array( 'tema' ),
	) );
	register_post_meta( 'evento', 'aforo_max', array( 'type' => 'integer', 'single' => true, 'show_in_rest' => true, 'description' => 'Plazas' ) );
} );
add_action( 'acf/init', function () {
	if ( ! function_exists( 'acf_add_local_field_group' ) ) {
		return;
	}
	acf_add_local_field_group( array(
		'key' => 'group_evento', 'title' => 'Datos del evento', 'show_in_rest' => 1,
		'location' => array( array( array( 'param' => 'post_type', 'operator' => '==', 'value' => 'evento' ) ) ),
		'fields' => array(
			array( 'key' => 'field_lugar', 'name' => 'lugar', 'label' => 'Lugar', 'type' => 'text', 'required' => 1, 'instructions' => 'Dónde se celebra' ),
			array( 'key' => 'field_fecha', 'name' => 'fecha', 'label' => 'Fecha', 'type' => 'date_picker', 'display_format' => 'd/m/Y', 'return_format' => 'Ymd' ),
			array( 'key' => 'field_gratis', 'name' => 'gratis', 'label' => 'Entrada gratuita', 'type' => 'true_false' ),
		),
	) );
} );
add_filter( 'pll_get_post_types', function ( $types ) {
	$types['evento'] = 'evento';
	return $types;
}, 10, 1 );
PHP
)"
wp eval "wp_mkdir_p( WPMU_PLUGIN_DIR ); file_put_contents( WPMU_PLUGIN_DIR . '/ecos-pruebas.php', base64_decode( '${MU_B64}' ) );" || exit 1
LANG_OK=0
if wp pll lang create Español es es_ES --no_default_cat >/dev/null 2>&1 && wp pll lang create English en en_US --no_default_cat >/dev/null 2>&1; then
  LANG_OK=1
else
  echo "::warning::No se pudieron crear los idiomas de Polylang (¿sin «wp pll» o sin red para los paquetes de idioma?): se omiten las pruebas de idiomas" >&2
fi

echo "== Complemento de Ecos"
wp plugin install /ecos-build/ecos-wordpress.zip --activate --force || exit 1

echo "== Usuario y contraseña de aplicación"
wp user create "$USER_NAME" ecostest@example.org --role=administrator --user_pass="$(openssl rand -hex 12)" || exit 1
APP_PASS="$(wp user application-password create "$USER_NAME" ecos-ci --porcelain | tr -d '\r\n')"
[ -n "$APP_PASS" ] || { echo "No se pudo crear la contraseña de aplicación" >&2; exit 1; }

echo "== Colaborador y editor (revisión entre varias personas)"
wp user create ecoscontrib ecoscontrib@example.org --role=contributor --display_name="Luis Colaborador" --user_pass="$(openssl rand -hex 12)" || exit 1
wp user create ecoseditor ecoseditor@example.org --role=editor --display_name="Marta Editora" --user_pass="$(openssl rand -hex 12)" || exit 1
CONTRIB_PASS="$(wp user application-password create ecoscontrib ecos-ci --porcelain | tr -d '\r\n')"
EDITOR_PASS="$(wp user application-password create ecoseditor ecos-ci --porcelain | tr -d '\r\n')"
[ -n "$CONTRIB_PASS" ] && [ -n "$EDITOR_PASS" ] || { echo "No se pudieron crear las contraseñas de aplicación del colaborador y del editor" >&2; exit 1; }

echo "::add-mask::$APP_PASS"
echo "::add-mask::$CONTRIB_PASS"
echo "::add-mask::$EDITOR_PASS"
if [ -n "${GITHUB_ENV:-}" ]; then
  { echo "WP_URL=$SITE"; echo "WP_USER=$USER_NAME"; echo "WP_APP_PASSWORD=$APP_PASS"; echo "WP_EXPECT_SPECTRA=1"; echo "WP_CONTRIB_USER=ecoscontrib"; echo "WP_CONTRIB_APP_PASSWORD=$CONTRIB_PASS"; echo "WP_EDITOR_USER=ecoseditor"; echo "WP_EDITOR_APP_PASSWORD=$EDITOR_PASS"; echo "WP_EXPECT_CPT=1"; echo "WP_CLI_DOCKER=1"; if [ "$LANG_OK" = 1 ]; then echo "WP_EXPECT_LANG=1"; fi; } >> "$GITHUB_ENV"
else
  echo
  echo "Listo. Ejecuta:"
  echo "  export WP_URL=$SITE WP_USER=$USER_NAME WP_APP_PASSWORD='$APP_PASS' WP_EXPECT_SPECTRA=1 WP_CLI_DOCKER=1 WP_EXPECT_CPT=1$([ \"$LANG_OK\" = 1 ] && echo ' WP_EXPECT_LANG=1')"
  echo "  export WP_CONTRIB_USER=ecoscontrib WP_CONTRIB_APP_PASSWORD='$CONTRIB_PASS' WP_EDITOR_USER=ecoseditor WP_EDITOR_APP_PASSWORD='$EDITOR_PASS'"
  echo "  npm run test:wp"
  echo "Para apagarlo: docker compose -f test-wp/docker-compose.yml down -v"
fi
exit 0
