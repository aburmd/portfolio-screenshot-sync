const awsConfig = {
  Auth: {
    Cognito: {
      userPoolId: "us-west-1_7ab4WjPy2",
      userPoolClientId: "6kf1s5uiigv3uhln4k160368co",
      loginWith: {
        oauth: {
          domain: "portfolio-sync-dev.auth.us-west-1.amazoncognito.com",
          scopes: ["openid", "email", "profile"],
          redirectSignIn: ["http://localhost:3000/callback"],
          redirectSignOut: ["http://localhost:3000/"],
          responseType: "code",
        },
      },
    },
  },
};

export default awsConfig;
