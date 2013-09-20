'use strict';

var app = angular.module('app', [
  'app.constants',
  'app.helpers',
  'app.i18n',
  'app.filters',
  'app.services',
  'app.directives',
  'app.vis',
  'ngSanitize',
  'angulartics',
  'angulartics.google.analytics',
  'ui.event',
  'ui.if',
  'ui.showhide',
  'ui.select2',
  'ui.validate',
  'ui.bootstrap'
  ])
  // angulartics config
  .config(function ($analyticsProvider) {
    // turn off automatic tracking
    $analyticsProvider.virtualPageviews(false);
  })
  // angular ui bootstrap config
  .config(function($dialogProvider) {
    $dialogProvider.options({
      backdrop: false,
      dialogFade: true,
      keyboard: false,
      backdropClick: false
    });
  })
  .config(function($tooltipProvider) {
    $tooltipProvider.options({
      appendToBody: true
    });
  })
  // angular-ui config
  .value('ui.config', {
    animate: 'ui-hide',
  })
  .run(function ($filter, $log, $rootScope, $timeout, $window, apiSrvc, modelSrvc, ENUMS, EXTERNAL_URL, GOOGLE_ANALYTICS_WEBPROP_ID, GOOGLE_ANALYTICS_DISABLE_KEY, LANTERNUI_VER, MODAL) {
    var CONNECTIVITY = ENUMS.CONNECTIVITY,
        MODE = ENUMS.MODE,
        i18nFltr = $filter('i18n'),
        jsonFltr = $filter('json'),
        model = modelSrvc.model,
        prettyUserFltr = $filter('prettyUser'),
        reportedStateFltr = $filter('reportedState');

    // start out with analytics disabled
    // https://developers.google.com/analytics/devguides/collection/analyticsjs/advanced#optout
    $window[GOOGLE_ANALYTICS_DISABLE_KEY] = true;

    // for easier inspection in the JavaScript console
    $window.rootScope = $rootScope;
    $window.model = model;

    $rootScope.EXTERNAL_URL = EXTERNAL_URL;
    $rootScope.lanternUiVersion = LANTERNUI_VER.join('.');
    $rootScope.model = model;
    $rootScope.DEFAULT_AVATAR_URL = 'img/default-avatar.png';

    angular.forEach(ENUMS, function(val, key) {
      $rootScope[key] = val;
    });

    var gaCreated = false;
    function trackPageView(sessionControl) {
      if (!gaCreated) {
        // https://developers.google.com/analytics/devguides/collection/analyticsjs/field-reference
        ga('create', GOOGLE_ANALYTICS_WEBPROP_ID, {cookieDomain: 'none'});
        ga('set', 'anonymizeIp', true);
        ga('set', 'forceSSL', true);
        ga('set', 'location', 'http://lantern-ui/');
        ga('set', 'hostname', 'lantern-ui');
        ga('set', 'title', 'lantern-ui');
        gaCreated = true;
      }
      var page = MODAL[model.modal] || '/';
      ga('set', 'page', page);
      ga('send', 'pageview', sessionControl ? {sessionControl: sessionControl} : undefined);
      $log.debug('[Analytics]', sessionControl === 'end' ? 'sent analytics session end' : 'tracked pageview', 'page =', page);
    }

    function stopTracking() {
      trackPageView('end'); // force the current session to end with this hit
      $window[GOOGLE_ANALYTICS_DISABLE_KEY] = true;
    }

    function startTracking() {
      $window[GOOGLE_ANALYTICS_DISABLE_KEY] = false;
      trackPageView('start');
    }

    $rootScope.$watch('model.settings.autoReport', function (autoReport, autoReportOld) {
      if (!model.setupComplete) return;
      if (!autoReport && autoReportOld) {
        stopTracking();
      } else if (autoReport && !autoReportOld) {
        startTracking();
      }
    });

    $rootScope.$watch('model.modal', function (modal) {
      if (!model.setupComplete || !model.settings.autoReport) return;
      trackPageView('start');
    });

    $rootScope.$watch('model.notifications', function (notifications) {
      _.each(notifications, function(notification, id) {
        if (notification.autoClose) {
          $timeout(function() {
            $rootScope.interaction(INTERACTION.close, {notification: id, auto: true});
          }, notification.autoClose * 1000);
        }
      });
    }, true);

    $rootScope.$watch('model.settings.mode', function (mode) {
      $rootScope.inGiveMode = mode === MODE.give;
      $rootScope.inGetMode = mode === MODE.get;
    });

    $rootScope.$watch('model.mock', function (mock) {
      $rootScope.mockBackend = !!mock;
    });

    $rootScope.$watch('model.location.country', function (country) {
      if (country && model.countries[country]) {
        $rootScope.inCensoringCountry = model.countries[country].censors;
      }
    });

    $rootScope.$watch('model.roster', function (roster) {
      if (!roster) return;
      updateContactCompletions();
    }, true);

    $rootScope.$watch('model.friends', function (friends) {
      if (!friends) return;
      $rootScope.friendsByEmail = {};
      $rootScope.nfriends = 0;
      $rootScope.npending = 0;
      for (var i=0, l=friends.length, ii=friends[i]; ii; ii=friends[++i]) {
        $rootScope.friendsByEmail[ii.email] = ii;
        if (ii.status === FRIEND_STATUS.pending) {
          $rootScope.npending++;
        } else if (ii.status == FRIEND_STATUS.friend) {
          $rootScope.nfriends++;
        }
      }
      updateContactCompletions();
    }, true);
    
    $rootScope.$watch('model.countries', function(countries) {
      // Calculate total number of users across all countries and add to scope
      // We do this because model.global.nusers is currently inaccurate
      var ever = 0,
          online = 0,
          countryCode,
          country;
      if (countries) {
        for (countryCode in countries) {
          country = countries[countryCode];
          if (country.nusers) {
            ever += country.nusers.ever || 0;
            online += country.nusers.online || 0;
          }
        }
      }
      $rootScope.nusersAcrossCountries = {
          ever: ever,
          online: online
      };
    }, true);

    function updateContactCompletions() {
      var roster = model.roster;
      if (!roster) return;
      var completions = {};
      _.each(model.friends, function (friend) {
        if (friend.status !== FRIEND_STATUS.friend) {
          completions[friend.email] = friend;
        }
      });
      if ($rootScope.friendsByEmail) {
        _.each(roster, function (contact) {
          var email = contact.email, friend = email && $rootScope.friendsByEmail[email];
          if (email && (!friend || friend.status !== FRIEND_STATUS.friend)) {
            // if an entry for this email was added in the previous loop, we want
            // this entry to overwrite it since the roster object has more data
            completions[contact.email] = contact;
          }
        });
      }
      completions = _.sortBy(completions, function (i) { return prettyUserFltr(i); }); // XXX sort by contact frequency instead
      $rootScope.contactCompletions = completions;
    }

    $rootScope.reload = function () {
      location.reload(true); // true to bypass cache and force request to server
    };

    $rootScope.interaction = function (interactionid, extra) {
      return apiSrvc.interaction(interactionid, extra)
        .success(function(data, status, headers, config) {
          $log.debug('interaction(', interactionid, extra || '', ') successful');
          if (model.settings.autoReport &&
              interactionid === INTERACTION.reset && model.modal === MODAL.confirmReset) {
            stopTracking();
          }
        })
        .error(function(data, status, headers, config) {
          $log.error('interaction(', interactionid, extra, ') failed');
          apiSrvc.exception({data: data, status: status, headers: headers, config: config});
        });
    };

    $rootScope.changeSetting = function(key, val) {
      var update = {path: '/settings/'+key, value: val};
      return $rootScope.interaction(INTERACTION.set, update);
    };

    $rootScope.changeLang = function(lang) {
      return $rootScope.interaction(INTERACTION.changeLang, {lang: lang});
    };

    $rootScope.openExternal = function(url) {
      if ($rootScope.mockBackend) {
        return $window.open(url);
      } else {
        return $rootScope.interaction(INTERACTION.url, {url: url});
      }
    };

    $rootScope.defaultReportMsg = function() {
      var reportedState = jsonFltr(reportedStateFltr($rootScope.model));
      return i18nFltr('MESSAGE_PLACEHOLDER') + reportedState;
    };
  });
