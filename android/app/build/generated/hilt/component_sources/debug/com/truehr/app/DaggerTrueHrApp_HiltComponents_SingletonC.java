package com.truehr.app;

import android.app.Activity;
import android.app.Service;
import android.view.View;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.SavedStateHandle;
import androidx.lifecycle.ViewModel;
import com.truehr.app.data.local.TokenStore;
import com.truehr.app.data.remote.ApiService;
import com.truehr.app.data.remote.AuthInterceptor;
import com.truehr.app.data.repository.AttendanceRepositoryImpl;
import com.truehr.app.data.repository.AuthRepositoryImpl;
import com.truehr.app.data.repository.CompOffRepositoryImpl;
import com.truehr.app.data.repository.LeaveRepositoryImpl;
import com.truehr.app.data.repository.MissPunchRepositoryImpl;
import com.truehr.app.data.repository.OnDutyRepositoryImpl;
import com.truehr.app.data.repository.ProfileRepositoryImpl;
import com.truehr.app.data.repository.SupportRepositoryImpl;
import com.truehr.app.di.NetworkModule_ApiServiceFactory;
import com.truehr.app.di.NetworkModule_JsonFactory;
import com.truehr.app.di.NetworkModule_OkHttpFactory;
import com.truehr.app.di.NetworkModule_RetrofitFactory;
import com.truehr.app.domain.repository.AttendanceRepository;
import com.truehr.app.domain.repository.AuthRepository;
import com.truehr.app.domain.repository.CompOffRepository;
import com.truehr.app.domain.repository.LeaveRepository;
import com.truehr.app.domain.repository.MissPunchRepository;
import com.truehr.app.domain.repository.OnDutyRepository;
import com.truehr.app.domain.repository.ProfileRepository;
import com.truehr.app.domain.repository.SupportRepository;
import com.truehr.app.presentation.auth.ChangePasswordViewModel;
import com.truehr.app.presentation.auth.ChangePasswordViewModel_HiltModules;
import com.truehr.app.presentation.auth.LoginViewModel;
import com.truehr.app.presentation.auth.LoginViewModel_HiltModules;
import com.truehr.app.presentation.dashboard.DashboardViewModel;
import com.truehr.app.presentation.dashboard.DashboardViewModel_HiltModules;
import com.truehr.app.presentation.feature.AddressBookViewModel;
import com.truehr.app.presentation.feature.AddressBookViewModel_HiltModules;
import com.truehr.app.presentation.feature.AttendanceViewModel;
import com.truehr.app.presentation.feature.AttendanceViewModel_HiltModules;
import com.truehr.app.presentation.feature.CompOffViewModel;
import com.truehr.app.presentation.feature.CompOffViewModel_HiltModules;
import com.truehr.app.presentation.feature.LeaveViewModel;
import com.truehr.app.presentation.feature.LeaveViewModel_HiltModules;
import com.truehr.app.presentation.feature.MissPunchViewModel;
import com.truehr.app.presentation.feature.MissPunchViewModel_HiltModules;
import com.truehr.app.presentation.feature.OnDutyViewModel;
import com.truehr.app.presentation.feature.OnDutyViewModel_HiltModules;
import com.truehr.app.presentation.feature.SupportViewModel;
import com.truehr.app.presentation.feature.SupportViewModel_HiltModules;
import com.truehr.app.presentation.feature.TeamListViewModel;
import com.truehr.app.presentation.feature.TeamListViewModel_HiltModules;
import com.truehr.app.presentation.profile.ProfileViewModel;
import com.truehr.app.presentation.profile.ProfileViewModel_HiltModules;
import com.truehr.app.presentation.splash.SplashViewModel;
import com.truehr.app.presentation.splash.SplashViewModel_HiltModules;
import dagger.hilt.android.ActivityRetainedLifecycle;
import dagger.hilt.android.ViewModelLifecycle;
import dagger.hilt.android.internal.builders.ActivityComponentBuilder;
import dagger.hilt.android.internal.builders.ActivityRetainedComponentBuilder;
import dagger.hilt.android.internal.builders.FragmentComponentBuilder;
import dagger.hilt.android.internal.builders.ServiceComponentBuilder;
import dagger.hilt.android.internal.builders.ViewComponentBuilder;
import dagger.hilt.android.internal.builders.ViewModelComponentBuilder;
import dagger.hilt.android.internal.builders.ViewWithFragmentComponentBuilder;
import dagger.hilt.android.internal.lifecycle.DefaultViewModelFactories;
import dagger.hilt.android.internal.lifecycle.DefaultViewModelFactories_InternalFactoryFactory_Factory;
import dagger.hilt.android.internal.managers.ActivityRetainedComponentManager_LifecycleModule_ProvideActivityRetainedLifecycleFactory;
import dagger.hilt.android.internal.managers.SavedStateHandleHolder;
import dagger.hilt.android.internal.modules.ApplicationContextModule;
import dagger.hilt.android.internal.modules.ApplicationContextModule_ProvideContextFactory;
import dagger.internal.DaggerGenerated;
import dagger.internal.DoubleCheck;
import dagger.internal.IdentifierNameString;
import dagger.internal.KeepFieldType;
import dagger.internal.LazyClassKeyMap;
import dagger.internal.MapBuilder;
import dagger.internal.Preconditions;
import dagger.internal.Provider;
import java.util.Collections;
import java.util.Map;
import java.util.Set;
import javax.annotation.processing.Generated;
import kotlinx.serialization.json.Json;
import okhttp3.OkHttpClient;
import retrofit2.Retrofit;

@DaggerGenerated
@Generated(
    value = "dagger.internal.codegen.ComponentProcessor",
    comments = "https://dagger.dev"
)
@SuppressWarnings({
    "unchecked",
    "rawtypes",
    "KotlinInternal",
    "KotlinInternalInJava",
    "cast",
    "deprecation"
})
public final class DaggerTrueHrApp_HiltComponents_SingletonC {
  private DaggerTrueHrApp_HiltComponents_SingletonC() {
  }

  public static Builder builder() {
    return new Builder();
  }

  public static final class Builder {
    private ApplicationContextModule applicationContextModule;

    private Builder() {
    }

    public Builder applicationContextModule(ApplicationContextModule applicationContextModule) {
      this.applicationContextModule = Preconditions.checkNotNull(applicationContextModule);
      return this;
    }

    public TrueHrApp_HiltComponents.SingletonC build() {
      Preconditions.checkBuilderRequirement(applicationContextModule, ApplicationContextModule.class);
      return new SingletonCImpl(applicationContextModule);
    }
  }

  private static final class ActivityRetainedCBuilder implements TrueHrApp_HiltComponents.ActivityRetainedC.Builder {
    private final SingletonCImpl singletonCImpl;

    private SavedStateHandleHolder savedStateHandleHolder;

    private ActivityRetainedCBuilder(SingletonCImpl singletonCImpl) {
      this.singletonCImpl = singletonCImpl;
    }

    @Override
    public ActivityRetainedCBuilder savedStateHandleHolder(
        SavedStateHandleHolder savedStateHandleHolder) {
      this.savedStateHandleHolder = Preconditions.checkNotNull(savedStateHandleHolder);
      return this;
    }

    @Override
    public TrueHrApp_HiltComponents.ActivityRetainedC build() {
      Preconditions.checkBuilderRequirement(savedStateHandleHolder, SavedStateHandleHolder.class);
      return new ActivityRetainedCImpl(singletonCImpl, savedStateHandleHolder);
    }
  }

  private static final class ActivityCBuilder implements TrueHrApp_HiltComponents.ActivityC.Builder {
    private final SingletonCImpl singletonCImpl;

    private final ActivityRetainedCImpl activityRetainedCImpl;

    private Activity activity;

    private ActivityCBuilder(SingletonCImpl singletonCImpl,
        ActivityRetainedCImpl activityRetainedCImpl) {
      this.singletonCImpl = singletonCImpl;
      this.activityRetainedCImpl = activityRetainedCImpl;
    }

    @Override
    public ActivityCBuilder activity(Activity activity) {
      this.activity = Preconditions.checkNotNull(activity);
      return this;
    }

    @Override
    public TrueHrApp_HiltComponents.ActivityC build() {
      Preconditions.checkBuilderRequirement(activity, Activity.class);
      return new ActivityCImpl(singletonCImpl, activityRetainedCImpl, activity);
    }
  }

  private static final class FragmentCBuilder implements TrueHrApp_HiltComponents.FragmentC.Builder {
    private final SingletonCImpl singletonCImpl;

    private final ActivityRetainedCImpl activityRetainedCImpl;

    private final ActivityCImpl activityCImpl;

    private Fragment fragment;

    private FragmentCBuilder(SingletonCImpl singletonCImpl,
        ActivityRetainedCImpl activityRetainedCImpl, ActivityCImpl activityCImpl) {
      this.singletonCImpl = singletonCImpl;
      this.activityRetainedCImpl = activityRetainedCImpl;
      this.activityCImpl = activityCImpl;
    }

    @Override
    public FragmentCBuilder fragment(Fragment fragment) {
      this.fragment = Preconditions.checkNotNull(fragment);
      return this;
    }

    @Override
    public TrueHrApp_HiltComponents.FragmentC build() {
      Preconditions.checkBuilderRequirement(fragment, Fragment.class);
      return new FragmentCImpl(singletonCImpl, activityRetainedCImpl, activityCImpl, fragment);
    }
  }

  private static final class ViewWithFragmentCBuilder implements TrueHrApp_HiltComponents.ViewWithFragmentC.Builder {
    private final SingletonCImpl singletonCImpl;

    private final ActivityRetainedCImpl activityRetainedCImpl;

    private final ActivityCImpl activityCImpl;

    private final FragmentCImpl fragmentCImpl;

    private View view;

    private ViewWithFragmentCBuilder(SingletonCImpl singletonCImpl,
        ActivityRetainedCImpl activityRetainedCImpl, ActivityCImpl activityCImpl,
        FragmentCImpl fragmentCImpl) {
      this.singletonCImpl = singletonCImpl;
      this.activityRetainedCImpl = activityRetainedCImpl;
      this.activityCImpl = activityCImpl;
      this.fragmentCImpl = fragmentCImpl;
    }

    @Override
    public ViewWithFragmentCBuilder view(View view) {
      this.view = Preconditions.checkNotNull(view);
      return this;
    }

    @Override
    public TrueHrApp_HiltComponents.ViewWithFragmentC build() {
      Preconditions.checkBuilderRequirement(view, View.class);
      return new ViewWithFragmentCImpl(singletonCImpl, activityRetainedCImpl, activityCImpl, fragmentCImpl, view);
    }
  }

  private static final class ViewCBuilder implements TrueHrApp_HiltComponents.ViewC.Builder {
    private final SingletonCImpl singletonCImpl;

    private final ActivityRetainedCImpl activityRetainedCImpl;

    private final ActivityCImpl activityCImpl;

    private View view;

    private ViewCBuilder(SingletonCImpl singletonCImpl, ActivityRetainedCImpl activityRetainedCImpl,
        ActivityCImpl activityCImpl) {
      this.singletonCImpl = singletonCImpl;
      this.activityRetainedCImpl = activityRetainedCImpl;
      this.activityCImpl = activityCImpl;
    }

    @Override
    public ViewCBuilder view(View view) {
      this.view = Preconditions.checkNotNull(view);
      return this;
    }

    @Override
    public TrueHrApp_HiltComponents.ViewC build() {
      Preconditions.checkBuilderRequirement(view, View.class);
      return new ViewCImpl(singletonCImpl, activityRetainedCImpl, activityCImpl, view);
    }
  }

  private static final class ViewModelCBuilder implements TrueHrApp_HiltComponents.ViewModelC.Builder {
    private final SingletonCImpl singletonCImpl;

    private final ActivityRetainedCImpl activityRetainedCImpl;

    private SavedStateHandle savedStateHandle;

    private ViewModelLifecycle viewModelLifecycle;

    private ViewModelCBuilder(SingletonCImpl singletonCImpl,
        ActivityRetainedCImpl activityRetainedCImpl) {
      this.singletonCImpl = singletonCImpl;
      this.activityRetainedCImpl = activityRetainedCImpl;
    }

    @Override
    public ViewModelCBuilder savedStateHandle(SavedStateHandle handle) {
      this.savedStateHandle = Preconditions.checkNotNull(handle);
      return this;
    }

    @Override
    public ViewModelCBuilder viewModelLifecycle(ViewModelLifecycle viewModelLifecycle) {
      this.viewModelLifecycle = Preconditions.checkNotNull(viewModelLifecycle);
      return this;
    }

    @Override
    public TrueHrApp_HiltComponents.ViewModelC build() {
      Preconditions.checkBuilderRequirement(savedStateHandle, SavedStateHandle.class);
      Preconditions.checkBuilderRequirement(viewModelLifecycle, ViewModelLifecycle.class);
      return new ViewModelCImpl(singletonCImpl, activityRetainedCImpl, savedStateHandle, viewModelLifecycle);
    }
  }

  private static final class ServiceCBuilder implements TrueHrApp_HiltComponents.ServiceC.Builder {
    private final SingletonCImpl singletonCImpl;

    private Service service;

    private ServiceCBuilder(SingletonCImpl singletonCImpl) {
      this.singletonCImpl = singletonCImpl;
    }

    @Override
    public ServiceCBuilder service(Service service) {
      this.service = Preconditions.checkNotNull(service);
      return this;
    }

    @Override
    public TrueHrApp_HiltComponents.ServiceC build() {
      Preconditions.checkBuilderRequirement(service, Service.class);
      return new ServiceCImpl(singletonCImpl, service);
    }
  }

  private static final class ViewWithFragmentCImpl extends TrueHrApp_HiltComponents.ViewWithFragmentC {
    private final SingletonCImpl singletonCImpl;

    private final ActivityRetainedCImpl activityRetainedCImpl;

    private final ActivityCImpl activityCImpl;

    private final FragmentCImpl fragmentCImpl;

    private final ViewWithFragmentCImpl viewWithFragmentCImpl = this;

    private ViewWithFragmentCImpl(SingletonCImpl singletonCImpl,
        ActivityRetainedCImpl activityRetainedCImpl, ActivityCImpl activityCImpl,
        FragmentCImpl fragmentCImpl, View viewParam) {
      this.singletonCImpl = singletonCImpl;
      this.activityRetainedCImpl = activityRetainedCImpl;
      this.activityCImpl = activityCImpl;
      this.fragmentCImpl = fragmentCImpl;


    }
  }

  private static final class FragmentCImpl extends TrueHrApp_HiltComponents.FragmentC {
    private final SingletonCImpl singletonCImpl;

    private final ActivityRetainedCImpl activityRetainedCImpl;

    private final ActivityCImpl activityCImpl;

    private final FragmentCImpl fragmentCImpl = this;

    private FragmentCImpl(SingletonCImpl singletonCImpl,
        ActivityRetainedCImpl activityRetainedCImpl, ActivityCImpl activityCImpl,
        Fragment fragmentParam) {
      this.singletonCImpl = singletonCImpl;
      this.activityRetainedCImpl = activityRetainedCImpl;
      this.activityCImpl = activityCImpl;


    }

    @Override
    public DefaultViewModelFactories.InternalFactoryFactory getHiltInternalFactoryFactory() {
      return activityCImpl.getHiltInternalFactoryFactory();
    }

    @Override
    public ViewWithFragmentComponentBuilder viewWithFragmentComponentBuilder() {
      return new ViewWithFragmentCBuilder(singletonCImpl, activityRetainedCImpl, activityCImpl, fragmentCImpl);
    }
  }

  private static final class ViewCImpl extends TrueHrApp_HiltComponents.ViewC {
    private final SingletonCImpl singletonCImpl;

    private final ActivityRetainedCImpl activityRetainedCImpl;

    private final ActivityCImpl activityCImpl;

    private final ViewCImpl viewCImpl = this;

    private ViewCImpl(SingletonCImpl singletonCImpl, ActivityRetainedCImpl activityRetainedCImpl,
        ActivityCImpl activityCImpl, View viewParam) {
      this.singletonCImpl = singletonCImpl;
      this.activityRetainedCImpl = activityRetainedCImpl;
      this.activityCImpl = activityCImpl;


    }
  }

  private static final class ActivityCImpl extends TrueHrApp_HiltComponents.ActivityC {
    private final SingletonCImpl singletonCImpl;

    private final ActivityRetainedCImpl activityRetainedCImpl;

    private final ActivityCImpl activityCImpl = this;

    private ActivityCImpl(SingletonCImpl singletonCImpl,
        ActivityRetainedCImpl activityRetainedCImpl, Activity activityParam) {
      this.singletonCImpl = singletonCImpl;
      this.activityRetainedCImpl = activityRetainedCImpl;


    }

    @Override
    public void injectMainActivity(MainActivity arg0) {
    }

    @Override
    public DefaultViewModelFactories.InternalFactoryFactory getHiltInternalFactoryFactory() {
      return DefaultViewModelFactories_InternalFactoryFactory_Factory.newInstance(getViewModelKeys(), new ViewModelCBuilder(singletonCImpl, activityRetainedCImpl));
    }

    @Override
    public Map<Class<?>, Boolean> getViewModelKeys() {
      return LazyClassKeyMap.<Boolean>of(MapBuilder.<String, Boolean>newMapBuilder(13).put(LazyClassKeyProvider.com_truehr_app_presentation_feature_AddressBookViewModel, AddressBookViewModel_HiltModules.KeyModule.provide()).put(LazyClassKeyProvider.com_truehr_app_presentation_feature_AttendanceViewModel, AttendanceViewModel_HiltModules.KeyModule.provide()).put(LazyClassKeyProvider.com_truehr_app_presentation_auth_ChangePasswordViewModel, ChangePasswordViewModel_HiltModules.KeyModule.provide()).put(LazyClassKeyProvider.com_truehr_app_presentation_feature_CompOffViewModel, CompOffViewModel_HiltModules.KeyModule.provide()).put(LazyClassKeyProvider.com_truehr_app_presentation_dashboard_DashboardViewModel, DashboardViewModel_HiltModules.KeyModule.provide()).put(LazyClassKeyProvider.com_truehr_app_presentation_feature_LeaveViewModel, LeaveViewModel_HiltModules.KeyModule.provide()).put(LazyClassKeyProvider.com_truehr_app_presentation_auth_LoginViewModel, LoginViewModel_HiltModules.KeyModule.provide()).put(LazyClassKeyProvider.com_truehr_app_presentation_feature_MissPunchViewModel, MissPunchViewModel_HiltModules.KeyModule.provide()).put(LazyClassKeyProvider.com_truehr_app_presentation_feature_OnDutyViewModel, OnDutyViewModel_HiltModules.KeyModule.provide()).put(LazyClassKeyProvider.com_truehr_app_presentation_profile_ProfileViewModel, ProfileViewModel_HiltModules.KeyModule.provide()).put(LazyClassKeyProvider.com_truehr_app_presentation_splash_SplashViewModel, SplashViewModel_HiltModules.KeyModule.provide()).put(LazyClassKeyProvider.com_truehr_app_presentation_feature_SupportViewModel, SupportViewModel_HiltModules.KeyModule.provide()).put(LazyClassKeyProvider.com_truehr_app_presentation_feature_TeamListViewModel, TeamListViewModel_HiltModules.KeyModule.provide()).build());
    }

    @Override
    public ViewModelComponentBuilder getViewModelComponentBuilder() {
      return new ViewModelCBuilder(singletonCImpl, activityRetainedCImpl);
    }

    @Override
    public FragmentComponentBuilder fragmentComponentBuilder() {
      return new FragmentCBuilder(singletonCImpl, activityRetainedCImpl, activityCImpl);
    }

    @Override
    public ViewComponentBuilder viewComponentBuilder() {
      return new ViewCBuilder(singletonCImpl, activityRetainedCImpl, activityCImpl);
    }

    @IdentifierNameString
    private static final class LazyClassKeyProvider {
      static String com_truehr_app_presentation_dashboard_DashboardViewModel = "com.truehr.app.presentation.dashboard.DashboardViewModel";

      static String com_truehr_app_presentation_auth_LoginViewModel = "com.truehr.app.presentation.auth.LoginViewModel";

      static String com_truehr_app_presentation_feature_AttendanceViewModel = "com.truehr.app.presentation.feature.AttendanceViewModel";

      static String com_truehr_app_presentation_feature_CompOffViewModel = "com.truehr.app.presentation.feature.CompOffViewModel";

      static String com_truehr_app_presentation_feature_TeamListViewModel = "com.truehr.app.presentation.feature.TeamListViewModel";

      static String com_truehr_app_presentation_profile_ProfileViewModel = "com.truehr.app.presentation.profile.ProfileViewModel";

      static String com_truehr_app_presentation_feature_LeaveViewModel = "com.truehr.app.presentation.feature.LeaveViewModel";

      static String com_truehr_app_presentation_feature_SupportViewModel = "com.truehr.app.presentation.feature.SupportViewModel";

      static String com_truehr_app_presentation_feature_MissPunchViewModel = "com.truehr.app.presentation.feature.MissPunchViewModel";

      static String com_truehr_app_presentation_feature_OnDutyViewModel = "com.truehr.app.presentation.feature.OnDutyViewModel";

      static String com_truehr_app_presentation_splash_SplashViewModel = "com.truehr.app.presentation.splash.SplashViewModel";

      static String com_truehr_app_presentation_auth_ChangePasswordViewModel = "com.truehr.app.presentation.auth.ChangePasswordViewModel";

      static String com_truehr_app_presentation_feature_AddressBookViewModel = "com.truehr.app.presentation.feature.AddressBookViewModel";

      @KeepFieldType
      DashboardViewModel com_truehr_app_presentation_dashboard_DashboardViewModel2;

      @KeepFieldType
      LoginViewModel com_truehr_app_presentation_auth_LoginViewModel2;

      @KeepFieldType
      AttendanceViewModel com_truehr_app_presentation_feature_AttendanceViewModel2;

      @KeepFieldType
      CompOffViewModel com_truehr_app_presentation_feature_CompOffViewModel2;

      @KeepFieldType
      TeamListViewModel com_truehr_app_presentation_feature_TeamListViewModel2;

      @KeepFieldType
      ProfileViewModel com_truehr_app_presentation_profile_ProfileViewModel2;

      @KeepFieldType
      LeaveViewModel com_truehr_app_presentation_feature_LeaveViewModel2;

      @KeepFieldType
      SupportViewModel com_truehr_app_presentation_feature_SupportViewModel2;

      @KeepFieldType
      MissPunchViewModel com_truehr_app_presentation_feature_MissPunchViewModel2;

      @KeepFieldType
      OnDutyViewModel com_truehr_app_presentation_feature_OnDutyViewModel2;

      @KeepFieldType
      SplashViewModel com_truehr_app_presentation_splash_SplashViewModel2;

      @KeepFieldType
      ChangePasswordViewModel com_truehr_app_presentation_auth_ChangePasswordViewModel2;

      @KeepFieldType
      AddressBookViewModel com_truehr_app_presentation_feature_AddressBookViewModel2;
    }
  }

  private static final class ViewModelCImpl extends TrueHrApp_HiltComponents.ViewModelC {
    private final SingletonCImpl singletonCImpl;

    private final ActivityRetainedCImpl activityRetainedCImpl;

    private final ViewModelCImpl viewModelCImpl = this;

    private Provider<AddressBookViewModel> addressBookViewModelProvider;

    private Provider<AttendanceViewModel> attendanceViewModelProvider;

    private Provider<ChangePasswordViewModel> changePasswordViewModelProvider;

    private Provider<CompOffViewModel> compOffViewModelProvider;

    private Provider<DashboardViewModel> dashboardViewModelProvider;

    private Provider<LeaveViewModel> leaveViewModelProvider;

    private Provider<LoginViewModel> loginViewModelProvider;

    private Provider<MissPunchViewModel> missPunchViewModelProvider;

    private Provider<OnDutyViewModel> onDutyViewModelProvider;

    private Provider<ProfileViewModel> profileViewModelProvider;

    private Provider<SplashViewModel> splashViewModelProvider;

    private Provider<SupportViewModel> supportViewModelProvider;

    private Provider<TeamListViewModel> teamListViewModelProvider;

    private ViewModelCImpl(SingletonCImpl singletonCImpl,
        ActivityRetainedCImpl activityRetainedCImpl, SavedStateHandle savedStateHandleParam,
        ViewModelLifecycle viewModelLifecycleParam) {
      this.singletonCImpl = singletonCImpl;
      this.activityRetainedCImpl = activityRetainedCImpl;

      initialize(savedStateHandleParam, viewModelLifecycleParam);

    }

    @SuppressWarnings("unchecked")
    private void initialize(final SavedStateHandle savedStateHandleParam,
        final ViewModelLifecycle viewModelLifecycleParam) {
      this.addressBookViewModelProvider = new SwitchingProvider<>(singletonCImpl, activityRetainedCImpl, viewModelCImpl, 0);
      this.attendanceViewModelProvider = new SwitchingProvider<>(singletonCImpl, activityRetainedCImpl, viewModelCImpl, 1);
      this.changePasswordViewModelProvider = new SwitchingProvider<>(singletonCImpl, activityRetainedCImpl, viewModelCImpl, 2);
      this.compOffViewModelProvider = new SwitchingProvider<>(singletonCImpl, activityRetainedCImpl, viewModelCImpl, 3);
      this.dashboardViewModelProvider = new SwitchingProvider<>(singletonCImpl, activityRetainedCImpl, viewModelCImpl, 4);
      this.leaveViewModelProvider = new SwitchingProvider<>(singletonCImpl, activityRetainedCImpl, viewModelCImpl, 5);
      this.loginViewModelProvider = new SwitchingProvider<>(singletonCImpl, activityRetainedCImpl, viewModelCImpl, 6);
      this.missPunchViewModelProvider = new SwitchingProvider<>(singletonCImpl, activityRetainedCImpl, viewModelCImpl, 7);
      this.onDutyViewModelProvider = new SwitchingProvider<>(singletonCImpl, activityRetainedCImpl, viewModelCImpl, 8);
      this.profileViewModelProvider = new SwitchingProvider<>(singletonCImpl, activityRetainedCImpl, viewModelCImpl, 9);
      this.splashViewModelProvider = new SwitchingProvider<>(singletonCImpl, activityRetainedCImpl, viewModelCImpl, 10);
      this.supportViewModelProvider = new SwitchingProvider<>(singletonCImpl, activityRetainedCImpl, viewModelCImpl, 11);
      this.teamListViewModelProvider = new SwitchingProvider<>(singletonCImpl, activityRetainedCImpl, viewModelCImpl, 12);
    }

    @Override
    public Map<Class<?>, javax.inject.Provider<ViewModel>> getHiltViewModelMap() {
      return LazyClassKeyMap.<javax.inject.Provider<ViewModel>>of(MapBuilder.<String, javax.inject.Provider<ViewModel>>newMapBuilder(13).put(LazyClassKeyProvider.com_truehr_app_presentation_feature_AddressBookViewModel, ((Provider) addressBookViewModelProvider)).put(LazyClassKeyProvider.com_truehr_app_presentation_feature_AttendanceViewModel, ((Provider) attendanceViewModelProvider)).put(LazyClassKeyProvider.com_truehr_app_presentation_auth_ChangePasswordViewModel, ((Provider) changePasswordViewModelProvider)).put(LazyClassKeyProvider.com_truehr_app_presentation_feature_CompOffViewModel, ((Provider) compOffViewModelProvider)).put(LazyClassKeyProvider.com_truehr_app_presentation_dashboard_DashboardViewModel, ((Provider) dashboardViewModelProvider)).put(LazyClassKeyProvider.com_truehr_app_presentation_feature_LeaveViewModel, ((Provider) leaveViewModelProvider)).put(LazyClassKeyProvider.com_truehr_app_presentation_auth_LoginViewModel, ((Provider) loginViewModelProvider)).put(LazyClassKeyProvider.com_truehr_app_presentation_feature_MissPunchViewModel, ((Provider) missPunchViewModelProvider)).put(LazyClassKeyProvider.com_truehr_app_presentation_feature_OnDutyViewModel, ((Provider) onDutyViewModelProvider)).put(LazyClassKeyProvider.com_truehr_app_presentation_profile_ProfileViewModel, ((Provider) profileViewModelProvider)).put(LazyClassKeyProvider.com_truehr_app_presentation_splash_SplashViewModel, ((Provider) splashViewModelProvider)).put(LazyClassKeyProvider.com_truehr_app_presentation_feature_SupportViewModel, ((Provider) supportViewModelProvider)).put(LazyClassKeyProvider.com_truehr_app_presentation_feature_TeamListViewModel, ((Provider) teamListViewModelProvider)).build());
    }

    @Override
    public Map<Class<?>, Object> getHiltViewModelAssistedMap() {
      return Collections.<Class<?>, Object>emptyMap();
    }

    @IdentifierNameString
    private static final class LazyClassKeyProvider {
      static String com_truehr_app_presentation_feature_CompOffViewModel = "com.truehr.app.presentation.feature.CompOffViewModel";

      static String com_truehr_app_presentation_feature_MissPunchViewModel = "com.truehr.app.presentation.feature.MissPunchViewModel";

      static String com_truehr_app_presentation_profile_ProfileViewModel = "com.truehr.app.presentation.profile.ProfileViewModel";

      static String com_truehr_app_presentation_dashboard_DashboardViewModel = "com.truehr.app.presentation.dashboard.DashboardViewModel";

      static String com_truehr_app_presentation_feature_AddressBookViewModel = "com.truehr.app.presentation.feature.AddressBookViewModel";

      static String com_truehr_app_presentation_feature_AttendanceViewModel = "com.truehr.app.presentation.feature.AttendanceViewModel";

      static String com_truehr_app_presentation_auth_ChangePasswordViewModel = "com.truehr.app.presentation.auth.ChangePasswordViewModel";

      static String com_truehr_app_presentation_feature_LeaveViewModel = "com.truehr.app.presentation.feature.LeaveViewModel";

      static String com_truehr_app_presentation_feature_SupportViewModel = "com.truehr.app.presentation.feature.SupportViewModel";

      static String com_truehr_app_presentation_feature_OnDutyViewModel = "com.truehr.app.presentation.feature.OnDutyViewModel";

      static String com_truehr_app_presentation_feature_TeamListViewModel = "com.truehr.app.presentation.feature.TeamListViewModel";

      static String com_truehr_app_presentation_auth_LoginViewModel = "com.truehr.app.presentation.auth.LoginViewModel";

      static String com_truehr_app_presentation_splash_SplashViewModel = "com.truehr.app.presentation.splash.SplashViewModel";

      @KeepFieldType
      CompOffViewModel com_truehr_app_presentation_feature_CompOffViewModel2;

      @KeepFieldType
      MissPunchViewModel com_truehr_app_presentation_feature_MissPunchViewModel2;

      @KeepFieldType
      ProfileViewModel com_truehr_app_presentation_profile_ProfileViewModel2;

      @KeepFieldType
      DashboardViewModel com_truehr_app_presentation_dashboard_DashboardViewModel2;

      @KeepFieldType
      AddressBookViewModel com_truehr_app_presentation_feature_AddressBookViewModel2;

      @KeepFieldType
      AttendanceViewModel com_truehr_app_presentation_feature_AttendanceViewModel2;

      @KeepFieldType
      ChangePasswordViewModel com_truehr_app_presentation_auth_ChangePasswordViewModel2;

      @KeepFieldType
      LeaveViewModel com_truehr_app_presentation_feature_LeaveViewModel2;

      @KeepFieldType
      SupportViewModel com_truehr_app_presentation_feature_SupportViewModel2;

      @KeepFieldType
      OnDutyViewModel com_truehr_app_presentation_feature_OnDutyViewModel2;

      @KeepFieldType
      TeamListViewModel com_truehr_app_presentation_feature_TeamListViewModel2;

      @KeepFieldType
      LoginViewModel com_truehr_app_presentation_auth_LoginViewModel2;

      @KeepFieldType
      SplashViewModel com_truehr_app_presentation_splash_SplashViewModel2;
    }

    private static final class SwitchingProvider<T> implements Provider<T> {
      private final SingletonCImpl singletonCImpl;

      private final ActivityRetainedCImpl activityRetainedCImpl;

      private final ViewModelCImpl viewModelCImpl;

      private final int id;

      SwitchingProvider(SingletonCImpl singletonCImpl, ActivityRetainedCImpl activityRetainedCImpl,
          ViewModelCImpl viewModelCImpl, int id) {
        this.singletonCImpl = singletonCImpl;
        this.activityRetainedCImpl = activityRetainedCImpl;
        this.viewModelCImpl = viewModelCImpl;
        this.id = id;
      }

      @SuppressWarnings("unchecked")
      @Override
      public T get() {
        switch (id) {
          case 0: // com.truehr.app.presentation.feature.AddressBookViewModel 
          return (T) new AddressBookViewModel(singletonCImpl.bindProfileRepositoryProvider.get());

          case 1: // com.truehr.app.presentation.feature.AttendanceViewModel 
          return (T) new AttendanceViewModel(singletonCImpl.bindAttendanceRepositoryProvider.get());

          case 2: // com.truehr.app.presentation.auth.ChangePasswordViewModel 
          return (T) new ChangePasswordViewModel(singletonCImpl.bindAuthRepositoryProvider.get());

          case 3: // com.truehr.app.presentation.feature.CompOffViewModel 
          return (T) new CompOffViewModel(singletonCImpl.bindCompOffRepositoryProvider.get());

          case 4: // com.truehr.app.presentation.dashboard.DashboardViewModel 
          return (T) new DashboardViewModel(singletonCImpl.bindProfileRepositoryProvider.get(), singletonCImpl.bindAuthRepositoryProvider.get());

          case 5: // com.truehr.app.presentation.feature.LeaveViewModel 
          return (T) new LeaveViewModel(singletonCImpl.bindLeaveRepositoryProvider.get());

          case 6: // com.truehr.app.presentation.auth.LoginViewModel 
          return (T) new LoginViewModel(singletonCImpl.bindAuthRepositoryProvider.get());

          case 7: // com.truehr.app.presentation.feature.MissPunchViewModel 
          return (T) new MissPunchViewModel(singletonCImpl.bindMissPunchRepositoryProvider.get());

          case 8: // com.truehr.app.presentation.feature.OnDutyViewModel 
          return (T) new OnDutyViewModel(singletonCImpl.bindOnDutyRepositoryProvider.get());

          case 9: // com.truehr.app.presentation.profile.ProfileViewModel 
          return (T) new ProfileViewModel(singletonCImpl.bindProfileRepositoryProvider.get());

          case 10: // com.truehr.app.presentation.splash.SplashViewModel 
          return (T) new SplashViewModel(singletonCImpl.bindAuthRepositoryProvider.get());

          case 11: // com.truehr.app.presentation.feature.SupportViewModel 
          return (T) new SupportViewModel(singletonCImpl.bindSupportRepositoryProvider.get());

          case 12: // com.truehr.app.presentation.feature.TeamListViewModel 
          return (T) new TeamListViewModel(singletonCImpl.bindProfileRepositoryProvider.get());

          default: throw new AssertionError(id);
        }
      }
    }
  }

  private static final class ActivityRetainedCImpl extends TrueHrApp_HiltComponents.ActivityRetainedC {
    private final SingletonCImpl singletonCImpl;

    private final ActivityRetainedCImpl activityRetainedCImpl = this;

    private Provider<ActivityRetainedLifecycle> provideActivityRetainedLifecycleProvider;

    private ActivityRetainedCImpl(SingletonCImpl singletonCImpl,
        SavedStateHandleHolder savedStateHandleHolderParam) {
      this.singletonCImpl = singletonCImpl;

      initialize(savedStateHandleHolderParam);

    }

    @SuppressWarnings("unchecked")
    private void initialize(final SavedStateHandleHolder savedStateHandleHolderParam) {
      this.provideActivityRetainedLifecycleProvider = DoubleCheck.provider(new SwitchingProvider<ActivityRetainedLifecycle>(singletonCImpl, activityRetainedCImpl, 0));
    }

    @Override
    public ActivityComponentBuilder activityComponentBuilder() {
      return new ActivityCBuilder(singletonCImpl, activityRetainedCImpl);
    }

    @Override
    public ActivityRetainedLifecycle getActivityRetainedLifecycle() {
      return provideActivityRetainedLifecycleProvider.get();
    }

    private static final class SwitchingProvider<T> implements Provider<T> {
      private final SingletonCImpl singletonCImpl;

      private final ActivityRetainedCImpl activityRetainedCImpl;

      private final int id;

      SwitchingProvider(SingletonCImpl singletonCImpl, ActivityRetainedCImpl activityRetainedCImpl,
          int id) {
        this.singletonCImpl = singletonCImpl;
        this.activityRetainedCImpl = activityRetainedCImpl;
        this.id = id;
      }

      @SuppressWarnings("unchecked")
      @Override
      public T get() {
        switch (id) {
          case 0: // dagger.hilt.android.ActivityRetainedLifecycle 
          return (T) ActivityRetainedComponentManager_LifecycleModule_ProvideActivityRetainedLifecycleFactory.provideActivityRetainedLifecycle();

          default: throw new AssertionError(id);
        }
      }
    }
  }

  private static final class ServiceCImpl extends TrueHrApp_HiltComponents.ServiceC {
    private final SingletonCImpl singletonCImpl;

    private final ServiceCImpl serviceCImpl = this;

    private ServiceCImpl(SingletonCImpl singletonCImpl, Service serviceParam) {
      this.singletonCImpl = singletonCImpl;


    }
  }

  private static final class SingletonCImpl extends TrueHrApp_HiltComponents.SingletonC {
    private final ApplicationContextModule applicationContextModule;

    private final SingletonCImpl singletonCImpl = this;

    private Provider<TokenStore> tokenStoreProvider;

    private Provider<OkHttpClient> okHttpProvider;

    private Provider<Json> jsonProvider;

    private Provider<Retrofit> retrofitProvider;

    private Provider<ApiService> apiServiceProvider;

    private Provider<ProfileRepositoryImpl> profileRepositoryImplProvider;

    private Provider<ProfileRepository> bindProfileRepositoryProvider;

    private Provider<AttendanceRepositoryImpl> attendanceRepositoryImplProvider;

    private Provider<AttendanceRepository> bindAttendanceRepositoryProvider;

    private Provider<AuthRepositoryImpl> authRepositoryImplProvider;

    private Provider<AuthRepository> bindAuthRepositoryProvider;

    private Provider<CompOffRepositoryImpl> compOffRepositoryImplProvider;

    private Provider<CompOffRepository> bindCompOffRepositoryProvider;

    private Provider<LeaveRepositoryImpl> leaveRepositoryImplProvider;

    private Provider<LeaveRepository> bindLeaveRepositoryProvider;

    private Provider<MissPunchRepositoryImpl> missPunchRepositoryImplProvider;

    private Provider<MissPunchRepository> bindMissPunchRepositoryProvider;

    private Provider<OnDutyRepositoryImpl> onDutyRepositoryImplProvider;

    private Provider<OnDutyRepository> bindOnDutyRepositoryProvider;

    private Provider<SupportRepositoryImpl> supportRepositoryImplProvider;

    private Provider<SupportRepository> bindSupportRepositoryProvider;

    private SingletonCImpl(ApplicationContextModule applicationContextModuleParam) {
      this.applicationContextModule = applicationContextModuleParam;
      initialize(applicationContextModuleParam);

    }

    private AuthInterceptor authInterceptor() {
      return new AuthInterceptor(tokenStoreProvider.get());
    }

    @SuppressWarnings("unchecked")
    private void initialize(final ApplicationContextModule applicationContextModuleParam) {
      this.tokenStoreProvider = DoubleCheck.provider(new SwitchingProvider<TokenStore>(singletonCImpl, 1));
      this.okHttpProvider = DoubleCheck.provider(new SwitchingProvider<OkHttpClient>(singletonCImpl, 0));
      this.jsonProvider = DoubleCheck.provider(new SwitchingProvider<Json>(singletonCImpl, 5));
      this.retrofitProvider = DoubleCheck.provider(new SwitchingProvider<Retrofit>(singletonCImpl, 4));
      this.apiServiceProvider = DoubleCheck.provider(new SwitchingProvider<ApiService>(singletonCImpl, 3));
      this.profileRepositoryImplProvider = new SwitchingProvider<>(singletonCImpl, 2);
      this.bindProfileRepositoryProvider = DoubleCheck.provider((Provider) profileRepositoryImplProvider);
      this.attendanceRepositoryImplProvider = new SwitchingProvider<>(singletonCImpl, 6);
      this.bindAttendanceRepositoryProvider = DoubleCheck.provider((Provider) attendanceRepositoryImplProvider);
      this.authRepositoryImplProvider = new SwitchingProvider<>(singletonCImpl, 7);
      this.bindAuthRepositoryProvider = DoubleCheck.provider((Provider) authRepositoryImplProvider);
      this.compOffRepositoryImplProvider = new SwitchingProvider<>(singletonCImpl, 8);
      this.bindCompOffRepositoryProvider = DoubleCheck.provider((Provider) compOffRepositoryImplProvider);
      this.leaveRepositoryImplProvider = new SwitchingProvider<>(singletonCImpl, 9);
      this.bindLeaveRepositoryProvider = DoubleCheck.provider((Provider) leaveRepositoryImplProvider);
      this.missPunchRepositoryImplProvider = new SwitchingProvider<>(singletonCImpl, 10);
      this.bindMissPunchRepositoryProvider = DoubleCheck.provider((Provider) missPunchRepositoryImplProvider);
      this.onDutyRepositoryImplProvider = new SwitchingProvider<>(singletonCImpl, 11);
      this.bindOnDutyRepositoryProvider = DoubleCheck.provider((Provider) onDutyRepositoryImplProvider);
      this.supportRepositoryImplProvider = new SwitchingProvider<>(singletonCImpl, 12);
      this.bindSupportRepositoryProvider = DoubleCheck.provider((Provider) supportRepositoryImplProvider);
    }

    @Override
    public void injectTrueHrApp(TrueHrApp trueHrApp) {
      injectTrueHrApp2(trueHrApp);
    }

    @Override
    public Set<Boolean> getDisableFragmentGetContextFix() {
      return Collections.<Boolean>emptySet();
    }

    @Override
    public ActivityRetainedComponentBuilder retainedComponentBuilder() {
      return new ActivityRetainedCBuilder(singletonCImpl);
    }

    @Override
    public ServiceComponentBuilder serviceComponentBuilder() {
      return new ServiceCBuilder(singletonCImpl);
    }

    private TrueHrApp injectTrueHrApp2(TrueHrApp instance) {
      TrueHrApp_MembersInjector.injectOkHttpClient(instance, okHttpProvider.get());
      return instance;
    }

    private static final class SwitchingProvider<T> implements Provider<T> {
      private final SingletonCImpl singletonCImpl;

      private final int id;

      SwitchingProvider(SingletonCImpl singletonCImpl, int id) {
        this.singletonCImpl = singletonCImpl;
        this.id = id;
      }

      @SuppressWarnings("unchecked")
      @Override
      public T get() {
        switch (id) {
          case 0: // okhttp3.OkHttpClient 
          return (T) NetworkModule_OkHttpFactory.okHttp(singletonCImpl.authInterceptor());

          case 1: // com.truehr.app.data.local.TokenStore 
          return (T) new TokenStore(ApplicationContextModule_ProvideContextFactory.provideContext(singletonCImpl.applicationContextModule));

          case 2: // com.truehr.app.data.repository.ProfileRepositoryImpl 
          return (T) new ProfileRepositoryImpl(singletonCImpl.apiServiceProvider.get());

          case 3: // com.truehr.app.data.remote.ApiService 
          return (T) NetworkModule_ApiServiceFactory.apiService(singletonCImpl.retrofitProvider.get());

          case 4: // retrofit2.Retrofit 
          return (T) NetworkModule_RetrofitFactory.retrofit(singletonCImpl.okHttpProvider.get(), singletonCImpl.jsonProvider.get());

          case 5: // kotlinx.serialization.json.Json 
          return (T) NetworkModule_JsonFactory.json();

          case 6: // com.truehr.app.data.repository.AttendanceRepositoryImpl 
          return (T) new AttendanceRepositoryImpl(singletonCImpl.apiServiceProvider.get());

          case 7: // com.truehr.app.data.repository.AuthRepositoryImpl 
          return (T) new AuthRepositoryImpl(singletonCImpl.apiServiceProvider.get(), singletonCImpl.tokenStoreProvider.get());

          case 8: // com.truehr.app.data.repository.CompOffRepositoryImpl 
          return (T) new CompOffRepositoryImpl(singletonCImpl.apiServiceProvider.get());

          case 9: // com.truehr.app.data.repository.LeaveRepositoryImpl 
          return (T) new LeaveRepositoryImpl(singletonCImpl.apiServiceProvider.get());

          case 10: // com.truehr.app.data.repository.MissPunchRepositoryImpl 
          return (T) new MissPunchRepositoryImpl(singletonCImpl.apiServiceProvider.get());

          case 11: // com.truehr.app.data.repository.OnDutyRepositoryImpl 
          return (T) new OnDutyRepositoryImpl(singletonCImpl.apiServiceProvider.get());

          case 12: // com.truehr.app.data.repository.SupportRepositoryImpl 
          return (T) new SupportRepositoryImpl(singletonCImpl.apiServiceProvider.get());

          default: throw new AssertionError(id);
        }
      }
    }
  }
}
