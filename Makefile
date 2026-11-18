# SPDX-License-Identifier: GPL-3.0-or-later
include $(TOPDIR)/rules.mk

PKG_NAME:=smartsafehub-app-arcdrop
PKG_VERSION:=0.1.0
PKG_RELEASE:=19
PKG_LICENSE:=GPL-3.0-or-later
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=SmartSafeHub Contributors
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)

include $(INCLUDE_DIR)/package.mk

# The same source list is used by target package preparation and linking.
ARCDROP_SOURCES:=arcdrop.c http.c json_helpers.c lan.c peer_store.c session.c signaling.c signal_queue.c
ARCDROP_WEB_MODULES:=core.js api.js ui.js discovery.js transfer.js signaling.js session.js

define Package/smartsafehub-app-arcdrop
  SECTION:=net
  CATEGORY:=Network
  TITLE:=ArcDrop - local peer-to-peer file sharing
  DEPENDS:=+uhttpd +libjson-c
endef

define Package/smartsafehub-app-arcdrop/description
 Lightweight LAN-only WebRTC signaling and browser file sharing, using
 the router's existing uHTTPd HTTPS listener. File content never reaches
 the router's signaling endpoint.
endef

define Package/smartsafehub-app-arcdrop/conffiles
/etc/arcdrop.conf
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) $(addprefix ./src/,$(ARCDROP_SOURCES)) ./src/arcdrop.h $(PKG_BUILD_DIR)/
	$(CP) ./LICENSE $(PKG_BUILD_DIR)/LICENSE
endef

define Build/Compile
	$(TARGET_CC) $(TARGET_CFLAGS) -std=c11 -Wall -Wextra -Os \
		-fstack-protector-strong \
		-o $(PKG_BUILD_DIR)/arcdrop $(addprefix $(PKG_BUILD_DIR)/,$(ARCDROP_SOURCES)) \
		$(TARGET_LDFLAGS) -ljson-c
endef

define Package/smartsafehub-app-arcdrop/install
	$(INSTALL_DIR) $(1)/www/arcdrop $(1)/www/arcdrop/js $(1)/www/cgi-bin $(1)/etc
	$(INSTALL_DATA) ./web/index.html $(1)/www/arcdrop/index.html
	$(INSTALL_DATA) ./web/app.js $(1)/www/arcdrop/app.js
	$(INSTALL_DATA) $(addprefix ./web/js/,$(ARCDROP_WEB_MODULES)) $(1)/www/arcdrop/js/
	$(INSTALL_DATA) ./web/style.css $(1)/www/arcdrop/style.css
	$(INSTALL_DATA) ./web/icon.svg $(1)/www/arcdrop/icon.svg
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/arcdrop $(1)/www/cgi-bin/arcdrop
	$(INSTALL_CONF) ./root/etc/arcdrop.conf $(1)/etc/arcdrop.conf
endef

$(eval $(call BuildPackage,smartsafehub-app-arcdrop))
