#!/usr/bin/env bash
# Levanta WordPress + MySQL con Docker y lo deja listo para `npm run test:wp`:
# tema Astra, plugins Spectra y Yoast SEO, el Complemento de Ecos (build/ecos-wordpress.zip), un usuario administrador y su contraseña de aplicación.
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
  if wp config path >/dev/null 2>&1 && wp db check >/dev/null 2>&1; then ready=1; break; fi
  sleep 5
done
[ "$ready" = 1 ] || { echo "WordPress/MySQL no arrancaron" >&2; docker compose logs --tail=60 >&2; exit 1; }

echo "== Instalando WordPress"
wp core install --url="$SITE" --title="Ecos pruebas" --admin_user=admin --admin_password="$(openssl rand -hex 12)" --admin_email=admin@example.org --skip-email || exit 1
wp rewrite structure '/%postname%/' --hard || exit 1   # sin enlaces permanentes /wp-json/ no responde en la imagen oficial

echo "== Tema y plugins (wordpress.org)"
need_external "instalar el tema Astra" wp theme install astra --activate
need_external "instalar Spectra y Yoast SEO" wp plugin install ultimate-addons-for-gutenberg wordpress-seo --activate

echo "== Complemento de Ecos"
wp plugin install /ecos-build/ecos-wordpress.zip --activate --force || exit 1

echo "== Usuario y contraseña de aplicación"
wp user create "$USER_NAME" ecostest@example.org --role=administrator --user_pass="$(openssl rand -hex 12)" || exit 1
APP_PASS="$(wp user application-password create "$USER_NAME" ecos-ci --porcelain | tr -d '\r\n')"
[ -n "$APP_PASS" ] || { echo "No se pudo crear la contraseña de aplicación" >&2; exit 1; }

echo "::add-mask::$APP_PASS"
if [ -n "${GITHUB_ENV:-}" ]; then
  { echo "WP_URL=$SITE"; echo "WP_USER=$USER_NAME"; echo "WP_APP_PASSWORD=$APP_PASS"; echo "WP_EXPECT_SPECTRA=1"; } >> "$GITHUB_ENV"
else
  echo
  echo "Listo. Ejecuta:"
  echo "  export WP_URL=$SITE WP_USER=$USER_NAME WP_APP_PASSWORD='$APP_PASS' WP_EXPECT_SPECTRA=1"
  echo "  npm run test:wp"
  echo "Para apagarlo: docker compose -f test-wp/docker-compose.yml down -v"
fi
